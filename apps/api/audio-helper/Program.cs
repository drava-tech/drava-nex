using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace AudioHelper;

class Program
{
    private static MMDeviceEnumerator _enumerator = new();
    // Multiple devices can be pinned at once (TARGET_DEVICE_NAMES) so a single
    // CMS slider drives all of them together. Index 0 is "primary" — its
    // volume/mute is what gets reported back to the CMS.
    private static List<MMDevice> _currentDevices = new();
    private static MMDevice? _currentDevice => _currentDevices.Count > 0 ? _currentDevices[0] : null;
    private static DeviceNotificationClient _notificationClient = new();
    private static readonly object _lock = new();

    static async Task Main(string[] args)
    {
        // Prevent application from crashing due to unhandled exceptions
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            Console.Error.WriteLine($"[Error] Unhandled exception: {e.ExceptionObject}");
        };

        try
        {
            InitializeAudio();

            // Start reading commands from stdin in a background task
            _ = Task.Run(ReadStdinAsync);

            // Print initial status
            ReportStatus();

            // Wait indefinitely
            await Task.Delay(Timeout.Infinite);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[FATAL] Initialization failed: {ex.Message}");
            Environment.Exit(1);
        }
    }

    private static void InitializeAudio()
    {
        lock (_lock)
        {
            // Clean up old subscriptions if any
            foreach (var device in _currentDevices)
            {
                try
                {
                    device.AudioEndpointVolume.OnVolumeNotification -= OnVolumeChanged;
                }
                catch { }
            }

            try
            {
                _currentDevices = ResolveTargetDevices();
                foreach (var device in _currentDevices)
                {
                    device.AudioEndpointVolume.OnVolumeNotification += OnVolumeChanged;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to get default audio endpoint: {ex.Message}");
                _currentDevices = new List<MMDevice>();
            }

            // Register notification callback for device changes (only once)
            try
            {
                // Unregister first to prevent duplicate registrations
                try { _enumerator.UnregisterEndpointNotificationCallback(_notificationClient); } catch { }
                _enumerator.RegisterEndpointNotificationCallback(_notificationClient);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to register endpoint callback: {ex.Message}");
            }
        }
    }

    // Windows' notion of "default" playback device can silently drift (HDMI
    // reconnects, driver updates, reboots) independently of which device(s) are
    // physically wired to the room's speakers. TARGET_DEVICE_NAMES (comma
    // separated, partial case-insensitive FriendlyName match) lets ops pin one
    // or more specific devices so a single CMS slider keeps controlling the
    // right outputs even after that drift. Unset/no matches preserves the old
    // behavior of following the OS default (single device).
    private static List<MMDevice> ResolveTargetDevices()
    {
        string? targetNames = Environment.GetEnvironmentVariable("TARGET_DEVICE_NAMES");
        if (!string.IsNullOrWhiteSpace(targetNames))
        {
            try
            {
                var wanted = targetNames.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var active = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).ToList();
                var matches = wanted
                    .Select(name => active.FirstOrDefault(d => d.FriendlyName.Contains(name, StringComparison.OrdinalIgnoreCase)))
                    .Where(d => d != null)
                    .Select(d => d!)
                    .ToList();

                if (matches.Count > 0)
                {
                    var unmatched = wanted.Where(name => !active.Any(d => d.FriendlyName.Contains(name, StringComparison.OrdinalIgnoreCase)));
                    foreach (var name in unmatched)
                    {
                        Console.Error.WriteLine($"[Warn] TARGET_DEVICE_NAMES entry '{name}' matched no active device.");
                    }
                    return matches;
                }
                Console.Error.WriteLine($"[Warn] TARGET_DEVICE_NAMES '{targetNames}' matched no active device; falling back to OS default.");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to enumerate audio endpoints for TARGET_DEVICE_NAMES lookup: {ex.Message}");
            }
        }

        var fallback = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console);
        return fallback != null ? new List<MMDevice> { fallback } : new List<MMDevice>();
    }

    private static void OnVolumeChanged(AudioVolumeNotificationData data)
    {
        ReportStatus();
    }

    public static void ReportStatus()
    {
        lock (_lock)
        {
            try
            {
                if (_currentDevice == null)
                {
                    var errorPayload = new
                    {
                        type = "status",
                        volume = 0,
                        muted = true,
                        device = "No active playback device"
                    };
                    Console.WriteLine(JsonSerializer.Serialize(errorPayload));
                    return;
                }

                // Primary device (index 0) is the source of truth reported back to the
                // CMS — all pinned devices are kept at the same volume/mute by
                // ExecuteAction, but only one number can drive a single UI slider.
                string friendlyName = _currentDevice.FriendlyName;
                string cleanName = CleanDeviceName(friendlyName);
                if (_currentDevices.Count > 1)
                {
                    cleanName = string.Join(" + ", _currentDevices.Select(d => CleanDeviceName(d.FriendlyName)));
                }

                var payload = new
                {
                    type = "status",
                    volume = (int)Math.Round(_currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar * 100),
                    muted = _currentDevice.AudioEndpointVolume.Mute,
                    device = cleanName
                };
                Console.WriteLine(JsonSerializer.Serialize(payload));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to report status: {ex.Message}");
            }
        }
    }

    private static string CleanDeviceName(string fullName)
    {
        if (string.IsNullOrEmpty(fullName)) return "Unknown Device";

        // Let's implement clean matching as per user requests: Sony HT-S60R or Samsung HDMI or Bluetooth Speaker.
        if (fullName.Contains("Sony HT-S60R", StringComparison.OrdinalIgnoreCase) || fullName.Contains("HT-S60R", StringComparison.OrdinalIgnoreCase))
            return "Sony HT-S60R";
        if (fullName.Contains("Samsung HDMI", StringComparison.OrdinalIgnoreCase) || (fullName.Contains("Samsung", StringComparison.OrdinalIgnoreCase) && fullName.Contains("HDMI", StringComparison.OrdinalIgnoreCase)))
            return "Samsung HDMI";
        if (fullName.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase))
            return "Bluetooth Speaker";

        // Fallback cleanings: e.g. "Speakers (Realtek(R) Audio)" -> "Realtek(R) Audio"
        if (fullName.StartsWith("Speakers (", StringComparison.OrdinalIgnoreCase))
        {
            int lastClose = fullName.LastIndexOf(')');
            if (lastClose > 10)
            {
                return fullName.Substring(10, lastClose - 10).Trim();
            }
        }

        // If it ends with something in parenthesis like "Realtek Digital Output (Realtek(R) Audio)",
        // clean it up to "Realtek Digital Output". Use the FIRST '(' (the one that opens the
        // driver-name suffix) — LastIndexOf would instead match the "(R)" trademark symbol
        // when the driver name contains one, truncating mid-word.
        int firstOpen = fullName.IndexOf('(');
        if (firstOpen > 0 && fullName.EndsWith(")"))
        {
            return fullName.Substring(0, firstOpen).Trim();
        }

        return fullName;
    }

    private static async Task ReadStdinAsync()
    {
        while (true)
        {
            string? line = await Console.In.ReadLineAsync();
            if (line == null) break; // Stdin closed

            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (root.TryGetProperty("action", out var actionProp))
                {
                    string action = actionProp.GetString() ?? "";
                    ExecuteAction(action, root);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to parse command: {ex.Message}");
            }
        }
    }

    private static void ExecuteAction(string action, JsonElement root)
    {
        lock (_lock)
        {
            if (_currentDevice == null)
            {
                InitializeAudio();
                if (_currentDevice == null)
                {
                    Console.Error.WriteLine("[Error] No active playback device available for execution");
                    return;
                }
            }

            try
            {
                switch (action.ToLowerInvariant())
                {
                    case "get":
                        ReportStatus();
                        break;
                    case "set-volume":
                        if (root.TryGetProperty("value", out var volVal))
                        {
                            int volume = volVal.GetInt32();
                            volume = Math.Clamp(volume, 0, 100);
                            foreach (var device in _currentDevices)
                            {
                                device.AudioEndpointVolume.MasterVolumeLevelScalar = volume / 100.0f;
                            }
                        }
                        break;
                    case "set-mute":
                        if (root.TryGetProperty("value", out var muteVal))
                        {
                            bool mute = muteVal.GetBoolean();
                            foreach (var device in _currentDevices)
                            {
                                device.AudioEndpointVolume.Mute = mute;
                            }
                        }
                        break;
                    case "toggle-mute":
                        {
                            // Toggle relative to the primary device so all pinned devices
                            // land on the same state (rather than each flipping its own).
                            bool nextMute = !_currentDevice.AudioEndpointVolume.Mute;
                            foreach (var device in _currentDevices)
                            {
                                device.AudioEndpointVolume.Mute = nextMute;
                            }
                        }
                        break;
                    case "increment":
                        {
                            int increment = 5;
                            if (root.TryGetProperty("value", out var incVal))
                            {
                                increment = incVal.GetInt32();
                            }
                            int currentVol = (int)Math.Round(_currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar * 100);
                            int nextVol = Math.Clamp(currentVol + increment, 0, 100);
                            foreach (var device in _currentDevices)
                            {
                                device.AudioEndpointVolume.MasterVolumeLevelScalar = nextVol / 100.0f;
                            }
                        }
                        break;
                    case "decrement":
                        {
                            int decrement = 5;
                            if (root.TryGetProperty("value", out var decVal))
                            {
                                decrement = decVal.GetInt32();
                            }
                            int currentVol = (int)Math.Round(_currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar * 100);
                            int nextVol = Math.Clamp(currentVol - decrement, 0, 100);
                            foreach (var device in _currentDevices)
                            {
                                device.AudioEndpointVolume.MasterVolumeLevelScalar = nextVol / 100.0f;
                            }
                        }
                        break;
                    default:
                        Console.Error.WriteLine($"[Error] Unknown action: {action}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Action execution failed: {ex.Message}");
            }
        }
    }

    private class DeviceNotificationClient : IMMNotificationClient
    {
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            if (flow == DataFlow.Render && role == Role.Console)
            {
                // Re-initialize audio device on another thread to avoid blocking COM callback
                Task.Run(() =>
                {
                    InitializeAudio();
                    ReportStatus();
                });
            }
        }

        public void OnDeviceAdded(string deviceId) { }
        public void OnDeviceRemoved(string deviceId) { }
        public void OnDeviceStateChanged(string deviceId, DeviceState newState) { }
        public void OnPropertyValueChanged(string deviceId, PropertyKey key) { }
    }
}
