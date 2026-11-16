// kiosk-cursor.cs: positions the OS cursor for agent.mjs when
// SCREEN_AGENT_FOLLOW_WINDOW is set. Compiled in memory by PowerShell's
// Add-Type (see kiosk-cursor.mjs), so it must stay C# 5: no string
// interpolation, no `out var`, no `?.`.
//
// Why it exists: node runs DPI-UNAWARE, and on a PC whose monitors use
// different scaling (a 4K TV at 200% beside a 1080p panel at 100%) Windows
// gives such a process a virtualised coordinate space it cannot leave the
// primary monitor in — nut-js's setPosition simply stops at the primary's
// edge. This helper runs its thread PER-MONITOR-V2 aware, so every coordinate
// below is a real physical pixel and the cursor can reach any monitor.
//
// It keeps the cursor inside the kiosk window (by process name), wherever that
// window is, so the CMS touchpad drives the screen and never the desktop
// beside it. Kiosk minimised or gone: the monitor it was last on. Never seen:
// the primary monitor (the old behaviour).
//
// Protocol: one command per line on stdin.
//   m <dx> <dy>  move by a delta in the pad's units (logical px)
//   f <id>       make sure the cursor is inside; replies "ok <id>"
//   j            nudge +1/-1 so Windows draws the cursor
// Startup prints "ready <description>"; a target change prints "target ...".
// With debug on, every move prints "pos <x> <y>".

using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

public static class KioskCursor
{
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public MOUSEINPUT mi; }

    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr m, int type, out uint dpiX, out uint dpiY);

    const uint MONITOR_DEFAULTTOPRIMARY = 1;
    const uint MONITOR_DEFAULTTONEAREST = 2;
    const int REFRESH_MS = 500;

    static string procName;
    static bool debug;
    static RECT area;            // where the cursor may be, physical px
    static double scale = 1.0;   // that monitor's DPI / 96
    static IntPtr lastMonitor = IntPtr.Zero;
    static int lastRefresh;
    static string lastDesc = "";

    public static void Run(string processName, bool debugOn)
    {
        procName = processName;
        debug = debugOn;
        // -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, for this thread only.
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        Refresh();
        Say("ready " + lastDesc);

        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            try { Handle(line.Trim()); }
            catch (Exception e) { Console.Error.WriteLine("[kiosk-cursor] " + e.Message); }
        }
    }

    static void Handle(string line)
    {
        if (line.Length == 0) return;
        string[] a = line.Split(' ');
        if (unchecked(Environment.TickCount - lastRefresh) > REFRESH_MS) Refresh();

        if (a[0] == "m" && a.Length >= 3)
        {
            double dx = double.Parse(a[1], CultureInfo.InvariantCulture);
            double dy = double.Parse(a[2], CultureInfo.InvariantCulture);
            POINT p = Inside();
            int x = Clamp((int)Math.Round(p.X + dx * scale), area.Left, area.Right - 1);
            int y = Clamp((int)Math.Round(p.Y + dy * scale), area.Top, area.Bottom - 1);
            MoveTo(x, y);
            if (debug) Say("pos " + x + " " + y);
        }
        else if (a[0] == "f")
        {
            Inside();
            Say("ok " + (a.Length > 1 ? a[1] : ""));
        }
        else if (a[0] == "j")
        {
            POINT p = Inside();
            SetCursorPos(p.X + 1, p.Y + 1);
            MoveTo(p.X, p.Y);
        }
    }

    /// Current position, first moved to the centre of the area if it was
    /// outside it (e.g. someone used the physical mouse on another monitor).
    static POINT Inside()
    {
        POINT p;
        GetCursorPos(out p);
        if (p.X < area.Left || p.X >= area.Right || p.Y < area.Top || p.Y >= area.Bottom)
        {
            p.X = (area.Left + area.Right) / 2;
            p.Y = (area.Top + area.Bottom) / 2;
            MoveTo(p.X, p.Y);
        }
        return p;
    }

    /// SetCursorPos, then a zero-length relative SendInput so the move also
    /// reaches apps as real mouse input (hover state, a hidden cursor redrawn).
    static void MoveTo(int x, int y)
    {
        SetCursorPos(x, y);
        INPUT[] input = new INPUT[1];
        input[0].type = 0;            // INPUT_MOUSE
        input[0].mi.dwFlags = 0x0001; // MOUSEEVENTF_MOVE, relative, 0,0
        SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Refresh()
    {
        lastRefresh = Environment.TickCount;
        IntPtr hwnd = FindKioskWindow();
        IntPtr mon;
        RECT r;
        string what;

        if (hwnd != IntPtr.Zero)
        {
            mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            RECT client;
            GetClientRect(hwnd, out client);
            POINT tl = new POINT();
            ClientToScreen(hwnd, ref tl);
            r.Left = tl.X;
            r.Top = tl.Y;
            r.Right = tl.X + (client.Right - client.Left);
            r.Bottom = tl.Y + (client.Bottom - client.Top);
            // A maximised borderless window overhangs its monitor slightly.
            RECT m;
            if (MonitorRect(mon, out m)) r = Intersect(r, m);
            lastMonitor = mon;
            what = procName + " window";
        }
        else
        {
            RECT m;
            if (lastMonitor != IntPtr.Zero && MonitorRect(lastMonitor, out m))
            {
                mon = lastMonitor;
                r = m;
                what = procName + " not visible, its last monitor";
            }
            else
            {
                mon = MonitorFromPoint(new POINT(), MONITOR_DEFAULTTOPRIMARY);
                MonitorRect(mon, out r);
                what = procName + " never seen, primary monitor";
            }
        }

        if (r.Right - r.Left < 2 || r.Bottom - r.Top < 2) return; // keep the old area

        uint dpiX, dpiY;
        scale = GetDpiForMonitor(mon, 0, out dpiX, out dpiY) == 0 && dpiX > 0 ? dpiX / 96.0 : 1.0;
        area = r;

        string desc = what + " " + r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top)
            + " scale " + scale.ToString("0.##", CultureInfo.InvariantCulture);
        if (desc != lastDesc)
        {
            if (lastDesc.Length > 0) Say("target " + desc);
            lastDesc = desc;
        }
    }

    static IntPtr FindKioskWindow()
    {
        foreach (Process p in Process.GetProcessesByName(procName))
        {
            using (p)
            {
                IntPtr h = p.MainWindowHandle;
                if (h != IntPtr.Zero && IsWindowVisible(h) && !IsIconic(h)) return h;
            }
        }
        return IntPtr.Zero;
    }

    static bool MonitorRect(IntPtr mon, out RECT r)
    {
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        bool ok = mon != IntPtr.Zero && GetMonitorInfo(mon, ref mi);
        r = mi.rcMonitor;
        return ok;
    }

    static RECT Intersect(RECT a, RECT b)
    {
        RECT r;
        r.Left = Math.Max(a.Left, b.Left);
        r.Top = Math.Max(a.Top, b.Top);
        r.Right = Math.Min(a.Right, b.Right);
        r.Bottom = Math.Min(a.Bottom, b.Bottom);
        return r;
    }

    static int Clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

    static void Say(string s)
    {
        Console.Out.WriteLine(s);
        Console.Out.Flush();
    }
}
