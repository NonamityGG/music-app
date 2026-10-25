// Резонанс для ПК — what the Quick settings shows and changes: the volume, the
// Wi-Fi and Bluetooth radios, and the battery.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Rezonans
{
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint ch, float level, ref Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(uint ch, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint count);
        [PreserveSig] int VolumeStepUp(ref Guid ctx);
        [PreserveSig] int VolumeStepDown(ref Guid ctx);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
        [PreserveSig] int GetVolumeRange(out float min, out float max, out float inc);
    }

    internal static class Status
    {
        private static Guid _ctx = Guid.Empty;
        private static readonly Guid IID_AudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

        private static IAudioEndpointVolume Volume()
        {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            if (en.GetDefaultAudioEndpoint(0 /* render */, 0 /* console */, out var devPtr) != 0 || devPtr == IntPtr.Zero) return null;
            var dev = (IMMDevice)Marshal.GetObjectForIUnknown(devPtr);
            Marshal.Release(devPtr);
            var iid = IID_AudioEndpointVolume;
            if (dev.Activate(ref iid, 1 /* inproc */, IntPtr.Zero, out var o) != 0 || o == null) return null;
            return (IAudioEndpointVolume)o;
        }

        internal static void SetVolume(int level)
        {
            try
            {
                var v = Volume();
                if (v == null) return;
                v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, level)) / 100f, ref _ctx);
                if (level > 0) v.SetMute(false, ref _ctx);
            }
            catch (Exception e) { Program.Log("громкость: " + e.Message); }
        }

        internal static void SetMute(bool mute)
        {
            try { Volume()?.SetMute(mute, ref _ctx); }
            catch (Exception e) { Program.Log("звук: " + e.Message); }
        }

        private static void ReadVolume(Dictionary<string, object> o)
        {
            try
            {
                var v = Volume();
                if (v == null) return;
                if (v.GetMasterVolumeLevelScalar(out var lvl) == 0) o["vol"] = (int)Math.Round(lvl * 100);
                if (v.GetMute(out var m) == 0) o["muted"] = m;
            }
            catch { }
        }

        private static void ReadBattery(Dictionary<string, object> o)
        {
            try
            {
                if (!ShellNative.GetSystemPowerStatus(out var s)) return;
                if (s.BatteryFlag != 128 && s.BatteryLifePercent <= 100) o["battery"] = (int)s.BatteryLifePercent; // 128 = no battery
                o["charging"] = s.ACLineStatus == 1;
            }
            catch { }
        }

        // Wi-Fi and Bluetooth through the WinRT radio API
        private static void ReadRadios(Dictionary<string, object> o)
        {
            try
            {
                var radios = Windows.Devices.Radios.Radio.GetRadiosAsync().AsTask().GetAwaiter().GetResult();
                foreach (var r in radios)
                {
                    bool on = r.State == Windows.Devices.Radios.RadioState.On;
                    if (r.Kind == Windows.Devices.Radios.RadioKind.WiFi) o["wifi"] = on;
                    else if (r.Kind == Windows.Devices.Radios.RadioKind.Bluetooth) o["bt"] = on;
                }
            }
            catch (Exception e) { Program.Log("радио: " + e.Message); }
        }

        internal static void SetRadio(string kind, bool on)
        {
            try
            {
                Windows.Devices.Radios.Radio.RequestAccessAsync().AsTask().GetAwaiter().GetResult();
                var radios = Windows.Devices.Radios.Radio.GetRadiosAsync().AsTask().GetAwaiter().GetResult();
                var want = kind == "wifi" ? Windows.Devices.Radios.RadioKind.WiFi : Windows.Devices.Radios.RadioKind.Bluetooth;
                foreach (var r in radios)
                    if (r.Kind == want)
                        r.SetStateAsync(on ? Windows.Devices.Radios.RadioState.On : Windows.Devices.Radios.RadioState.Off).AsTask().GetAwaiter().GetResult();
            }
            catch (Exception e) { Program.Log("радио (переключить): " + e.Message); }
        }

        internal static Dictionary<string, object> Snapshot()
        {
            var o = new Dictionary<string, object> { { "type", "status" } };
            ReadVolume(o);
            ReadBattery(o);
            ReadRadios(o);
            return o;
        }
    }
}
