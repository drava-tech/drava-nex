using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace LobbyKiosk;

public partial class MainWindow : Window
{
    private const string TargetUrl = "https://ec-cms/display/main-screen";
    private const string TrustedHost = "ec-cms";
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(5);

    private bool _allowClose;
    private readonly DispatcherTimer _retryTimer;
    private OverlayWindow? _overlay;

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
        // A WPF element can never visually sit on top of WebView2 — it's a real
        // native child window (airspace), so it always paints above anything in
        // the same window's visual tree. The button strip instead lives in its
        // own top-level window, owned by this one so Windows always keeps it
        // above its owner, letting the page render truly edge-to-edge.
        _overlay = new OverlayWindow { Owner = this };
        _overlay.MinimizeRequested += (_, _) => MinimizeKiosk();
        _overlay.CloseRequested += (_, _) =>
        {
            _allowClose = true;
            Close();
        };
        _overlay.AlignToScreen();
        _overlay.Show();

        await Browser.EnsureCoreWebView2Async();

        var core = Browser.CoreWebView2;

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;

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

        core.Navigate(TargetUrl);
    }

    // Lets the page at TrustedHost control the kiosk window via:
    //   window.chrome.webview.postMessage("minimize")
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
            case "close":
                _allowClose = true;
                Close();
                break;
        }
    }

    private void MinimizeKiosk()
    {
        _overlay?.Hide();
        Topmost = false;
        ShowInTaskbar = true;
        WindowState = WindowState.Minimized;
    }

    private void RestoreKiosk()
    {
        WindowState = WindowState.Maximized;
        ShowInTaskbar = false;
        Topmost = true;
        _overlay?.AlignToScreen();
        _overlay?.Show();
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
