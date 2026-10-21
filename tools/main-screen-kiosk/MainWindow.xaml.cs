using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace MainScreenKiosk;

public partial class MainWindow : Window
{
    private const string TargetUrl = "https://ec-cms/display/main-screen";
    private const string TrustedHost = "ec-cms";
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(5);

    // Sibling folder shipped alongside the published exe (see .csproj) —
    // strips X-Frame-Options/CSP so a pushed web page renders instead of
    // Chromium's "blocked" interstitial. See tools/frame-unlock-extension and
    // packages/types/src/media-content.ts (mediaAssetToWsContent's "link" comment).
    private const string FrameUnlockFolderName = "frame-unlock-extension";

    // Must match manifest.json's "name" field exactly — an unpacked
    // extension's Id isn't predictable ahead of installing it, so Name is the
    // only reliable way to detect "already installed" and avoid re-adding it
    // every launch.
    private const string FrameUnlockExtensionName = "CMS Platform — Frame Unlock";

    // Width (in CSS px) the page lays out at on any panel at least this wide —
    // the same 1920x1080 design size ScreenStage uses. See ApplyPageZoom.
    private const double ReferenceLayoutWidth = 1920.0;

    private bool _allowClose;
    // True after Esc: a normal window with a title bar (minimize, maximize,
    // close), like the Grid player. F11 or maximize brings the kiosk back.
    private bool _windowed;
    // Set while this code itself changes WindowState, so StateChanged doesn't
    // react to its own switch.
    private bool _switching;
    private readonly DispatcherTimer _retryTimer;

    public MainWindow()
    {
        InitializeComponent();

        _retryTimer = new DispatcherTimer { Interval = RetryDelay };
        _retryTimer.Tick += (_, _) =>
        {
            _retryTimer.Stop();
            Browser.CoreWebView2?.Navigate(TargetUrl);
        };

        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        // The WPF control's CreationProperties.AreBrowserExtensionsEnabled
        // shortcut does NOT reliably enable extensions in this SDK (confirmed
        // on this machine: AddBrowserExtensionAsync kept throwing
        // ERROR_NOT_SUPPORTED even on a brand-new profile with that property
        // set). Building the CoreWebView2Environment explicitly with
        // CoreWebView2EnvironmentOptions.AreBrowserExtensionsEnabled — the
        // path Microsoft's own docs/samples use — is what actually works.
        var environmentOptions = new CoreWebView2EnvironmentOptions
        {
            AreBrowserExtensionsEnabled = true,
            // Without this, Chromium (WebView2) only ever guarantees MUTED
            // autoplay — an unattended kiosk TV has no user gesture to unlock
            // unmuted playback, so any <video autoPlay muted={false}>
            // (VideoRenderer.tsx) just freezes on its first frame instead of
            // playing. Same flag already required and documented for the
            // alternate chrome.exe --kiosk path (.doc/device-setup.md).
            //
            // --force-device-scale-factor=1 pins the web content's device
            // scale factor to 1 regardless of the Windows display-scaling
            // setting on this PC. Windows defaults a 4K display to 150% or
            // 200%, which makes the CSS viewport 2560x1440 or 1920x1080; the
            // page then composites into a layer that size and the compositor
            // upscales it to the panel's real 3840x2160. A 4K video pushed to
            // that screen is downsampled to 1080p and blown back up — the
            // picture-quality complaint this fixes. At 1 the viewport equals
            // the physical pixels and full-bleed video (VideoRenderer, which
            // is 100vw/100vh) reaches the panel at native resolution.
            //
            // Template experiences are unaffected: ScreenStage lays out at a
            // fixed 1920x1080 and scales to fit, so it simply scales by 2
            // instead of 1 and rasterizes at the higher resolution.
            //
            // See also app.manifest — that stops Windows bitmap-stretching the
            // whole window, which is the other half of the same problem.
            //
            // Side effect: at 1 a pushed web page lays out 3840px wide and
            // reads as a desktop browser at 50% zoom. ApplyPageZoom fixes that
            // with WebView2 page zoom instead of changing this flag — page zoom
            // raises devicePixelRatio, so the layout is a normal 1920x1080
            // while Chromium still rasterizes (and draws video) at the panel's
            // physical 3840x2160.
            AdditionalBrowserArguments =
                "--autoplay-policy=no-user-gesture-required --force-device-scale-factor=1",
        };
        var environment = await CoreWebView2Environment.CreateAsync(null, null, environmentOptions);

        await Browser.EnsureCoreWebView2Async(environment);

        var core = Browser.CoreWebView2;

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        // Off (the WebView2 default, set explicitly because this was briefly
        // enabled for a since-removed zoom feature). Nothing in the display
        // pages intercepts Ctrl+wheel any more, so leaving it on would let a
        // stray Ctrl+wheel on this PC zoom the signage page with no in-app way
        // to reset it.
        core.Settings.IsZoomControlEnabled = false;

        core.ServerCertificateErrorDetected += (_, args) =>
        {
            var host = new Uri(args.RequestUri).Host;
            if (string.Equals(host, TrustedHost, StringComparison.OrdinalIgnoreCase))
            {
                args.Action = CoreWebView2ServerCertificateErrorAction.AlwaysAllow;
            }
        };

        ApplyPageZoom();
        SizeChanged += (_, _) => ApplyPageZoom();
        DpiChanged += (_, _) => ApplyPageZoom();

        core.NavigationCompleted += (_, args) =>
        {
            // The WPF control can drop its zoom on a navigation (including the
            // retry timer's re-navigate), so it is re-applied every time.
            ApplyPageZoom();

            if (!args.IsSuccess)
            {
                _retryTimer.Stop();
                _retryTimer.Start();
            }
        };

        core.ProcessFailed += (_, _) =>
        {
            _retryTimer.Stop();
            _retryTimer.Start();
        };

        core.WebMessageReceived += Core_WebMessageReceived;

        StateChanged += (_, _) =>
        {
            if (_switching || WindowState == WindowState.Minimized)
            {
                return;
            }

            // Kiosk restored from minimized (taskbar, remote): back to full
            // screen. Windowed and maximized (its button or a title-bar
            // double-click): that's asking for the whole screen, which a
            // maximized window doesn't give (title bar and taskbar stay).
            if (!_windowed || WindowState == WindowState.Maximized)
            {
                RestoreKiosk();
            }
        };

        await EnsureFrameUnlockExtensionLoadedAsync(core);

        core.Navigate(TargetUrl);
    }

    /// <summary>
    /// Zooms the page so it lays out at ReferenceLayoutWidth CSS px across the
    /// panel's physical width: 2.0 on the 4K TV, 1.0 (no zoom) on a 1080p
    /// panel or narrower. Physical width = WPF's DIP width x the monitor's DPI
    /// scale, which is exact because app.manifest makes this window
    /// PerMonitorV2 DPI aware. User zoom stays disabled (IsZoomControlEnabled).
    /// </summary>
    private void ApplyPageZoom()
    {
        if (Browser.CoreWebView2 is null || ActualWidth <= 0)
        {
            return;
        }

        var physicalWidth = ActualWidth * VisualTreeHelper.GetDpi(this).DpiScaleX;
        var zoom = Math.Max(1.0, physicalWidth / ReferenceLayoutWidth);
        if (Math.Abs(Browser.ZoomFactor - zoom) > 0.001)
        {
            Browser.ZoomFactor = zoom;
        }
    }

    /// <summary>
    /// Best-effort, non-fatal load of tools/frame-unlock-extension into this
    /// kiosk's WebView2 profile so a pushed URL that sends X-Frame-Options/CSP
    /// frame-ancestors renders instead of showing Chromium's "blocked" icon.
    /// Idempotent — checks GetBrowserExtensionsAsync() by Name before adding,
    /// so relaunching (or rebooting) the kiosk doesn't re-add it every time;
    /// once added it's persisted in this profile's user data folder permanently.
    ///
    /// Deliberately swallows every failure: a missing folder, an old WebView2
    /// Runtime that predates extension support, or any other
    /// AddBrowserExtensionAsync error must not stop the kiosk from starting —
    /// it just falls back to today's already-accepted trade-off (see
    /// packages/types/src/media-content.ts lines 394-400).
    /// </summary>
    private static async Task EnsureFrameUnlockExtensionLoadedAsync(CoreWebView2 core)
    {
        try
        {
            var folder = Path.Combine(AppContext.BaseDirectory, FrameUnlockFolderName);
            if (!File.Exists(Path.Combine(folder, "manifest.json")))
            {
                return; // not shipped alongside this build — nothing to load
            }

            var installed = await core.Profile.GetBrowserExtensionsAsync();
            if (installed.Any(ext => string.Equals(ext.Name, FrameUnlockExtensionName, StringComparison.Ordinal)))
            {
                return; // already installed in this profile from a previous launch
            }

            await core.Profile.AddBrowserExtensionAsync(folder);
        }
        catch
        {
            // Non-fatal by design — see docblock above.
        }
    }

    // Lets the page at TrustedHost control the kiosk window via:
    //   window.chrome.webview.postMessage("minimize")
    //   window.chrome.webview.postMessage("maximize")
    //   window.chrome.webview.postMessage("close")
    private void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var host = new Uri(e.Source).Host;
        if (!string.Equals(host, TrustedHost, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        string message;
        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch
        {
            return;
        }

        switch (message?.Trim().ToLowerInvariant())
        {
            case "minimize":
                MinimizeKiosk();
                break;
            case "maximize":
                RestoreKiosk();
                break;
            case "close":
                _allowClose = true;
                Close();
                break;
        }
    }

    private void MinimizeKiosk()
    {
        Topmost = false;
        ShowInTaskbar = true;
        WindowState = WindowState.Minimized;
    }

    private void RestoreKiosk()
    {
        _windowed = false;
        _switching = true;
        // Normal first: switching the frame off on an already-maximized window
        // leaves it sized to the work area, i.e. the taskbar still shows.
        WindowState = WindowState.Normal;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowState = WindowState.Maximized;
        _switching = false;
        ShowInTaskbar = false;
        Topmost = true;
    }

    /// <summary>Esc: a normal window with a title bar, so it can be minimized, moved or closed.</summary>
    private void LeaveKiosk()
    {
        _windowed = true;
        _switching = true;
        Topmost = false;
        ShowInTaskbar = true;
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.CanResize;
        WindowState = WindowState.Normal;
        Width = Math.Min(1280, SystemParameters.WorkArea.Width);
        Height = Math.Min(720, SystemParameters.WorkArea.Height);
        Left = SystemParameters.WorkArea.Left + (SystemParameters.WorkArea.Width - Width) / 2;
        Top = SystemParameters.WorkArea.Top + (SystemParameters.WorkArea.Height - Height) / 2;
        _switching = false;
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Full screen it can't be closed by accident (Alt+F4 on the TV);
        // windowed (after Esc) its close button and Alt+F4 work normally.
        if (!_allowClose && !_windowed)
        {
            e.Cancel = true;
        }
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        // Hidden escape hatch for maintenance: Ctrl+Shift+Alt+X closes the kiosk.
        // With Alt held, WPF reports the key as Key.System and puts the real
        // key in SystemKey, so e.Key alone is never Key.X here.
        var key = e.Key == Key.System ? e.SystemKey : e.Key;
        if (key == Key.X &&
            Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift | ModifierKeys.Alt))
        {
            _allowClose = true;
            Close();
            return;
        }

        // Same keys as the Grid player: Esc leaves full screen, F11 goes back.
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            if (!_windowed)
            {
                LeaveKiosk();
            }
            return;
        }

        if (e.Key == Key.F11)
        {
            e.Handled = true;
            if (_windowed)
            {
                RestoreKiosk();
            }
            return;
        }

        // Alt+F4 only while full screen; windowed, it closes like any app
        // (MainWindow_Closing decides).
        if (key == Key.F4 && Keyboard.Modifiers == ModifierKeys.Alt && !_windowed)
        {
            e.Handled = true;
        }
    }
}
