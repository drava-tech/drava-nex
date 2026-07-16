using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace AudioHelper;

class Program
{
    private static MMDeviceEnumerator _enumerator = new();
    private static MMDevice? _currentDevice;
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
            if (_currentDevice != null)
            {
                try
                {
                    _currentDevice.AudioEndpointVolume.OnVolumeNotification -= OnVolumeChanged;
                }
                catch { }
            }

            try
            {
                _currentDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console);
                if (_currentDevice != null)
                {
                    _currentDevice.AudioEndpointVolume.OnVolumeNotification += OnVolumeChanged;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Error] Failed to get default audio endpoint: {ex.Message}");
                _currentDevice = null;
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

                string friendlyName = _currentDevice.FriendlyName;
                string cleanName = CleanDeviceName(friendlyName);

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

        // If it ends with something in parenthesis like "Realtek Audio (USB Audio Device)", clean it up to "Realtek Audio"
        int lastOpen = fullName.LastIndexOf('(');
        if (lastOpen > 0 && fullName.EndsWith(")"))
        {
            return fullName.Substring(0, lastOpen).Trim();
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
                            _currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar = volume / 100.0f;
                        }
                        break;
                    case "set-mute":
                        if (root.TryGetProperty("value", out var muteVal))
                        {
                            bool mute = muteVal.GetBoolean();
                            _currentDevice.AudioEndpointVolume.Mute = mute;
                        }
                        break;
                    case "toggle-mute":
                        _currentDevice.AudioEndpointVolume.Mute = !_currentDevice.AudioEndpointVolume.Mute;
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
                            _currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar = nextVol / 100.0f;
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
                            _currentDevice.AudioEndpointVolume.MasterVolumeLevelScalar = nextVol / 100.0f;
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
