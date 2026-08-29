using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
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

    private bool _allowClose;
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
            AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required",
        };
        var environment = await CoreWebView2Environment.CreateAsync(null, null, environmentOptions);

        await Browser.EnsureCoreWebView2Async(environment);

        var core = Browser.CoreWebView2;

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        // Needed for the CMS touchpad's zoom in/out buttons — the native
        // screen-agent (apps/api/screen-agent/agent.mjs) simulates zoom as a
        // real Ctrl+MouseWheel gesture, which WebView2 only honors when this
        // is enabled. Display pages otherwise stay locked down (see
        // [screenId]/page.tsx's overflow:hidden) so this alone doesn't make
        // signage generally pannable/zoomable.
        core.Settings.IsZoomControlEnabled = true;

        core.ServerCertificateErrorDetected += (_, args) =>
        {
            var host = new Uri(args.RequestUri).Host;
            if (string.Equals(host, TrustedHost, StringComparison.OrdinalIgnoreCase))
            {
                args.Action = CoreWebView2ServerCertificateErrorAction.AlwaysAllow;
            }
        };

        core.NavigationCompleted += (_, args) =>
        {
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
            if (WindowState != WindowState.Minimized)
            {
                RestoreKiosk();
            }
        };

        await EnsureFrameUnlockExtensionLoadedAsync(core);

        core.Navigate(TargetUrl);
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
        WindowState = WindowState.Maximized;
        ShowInTaskbar = false;
        Topmost = true;
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
        }
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        // Hidden escape hatch for maintenance: Ctrl+Shift+Alt+X closes the kiosk.
        if (e.Key == Key.X &&
            Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift | ModifierKeys.Alt))
        {
            _allowClose = true;
            Close();
            return;
        }

        if (e.Key == Key.Escape || e.Key == Key.F11 ||
            (e.Key == Key.System && e.SystemKey == Key.F4))
        {
            e.Handled = true;
        }
    }
}
