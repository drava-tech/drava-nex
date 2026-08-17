using System;
using System.Windows;

namespace LobbyKiosk;

public partial class OverlayWindow : Window
{
    public event EventHandler? MinimizeRequested;
    public event EventHandler? CloseRequested;

    public OverlayWindow()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Positions this window flush against the top-right corner of the primary
    /// screen. Deliberately uses SystemParameters rather than the main window's
    /// Left/ActualWidth — those come from WPF's layout pass, which hasn't caught
    /// up yet immediately after WindowState flips to Maximized (e.g. right after
    /// restoring from minimized), leaving the overlay misplaced. The main window
    /// is always maximized + WindowStyle="None", so it covers the full screen
    /// from (0,0) regardless — screen metrics are available immediately.
    /// </summary>
    public void AlignToScreen()
    {
        Left = SystemParameters.PrimaryScreenWidth - Width;
        Top = 0;
    }

    private void MinimizeButton_Click(object sender, RoutedEventArgs e)
    {
        MinimizeRequested?.Invoke(this, EventArgs.Empty);
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e)
    {
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }
}
