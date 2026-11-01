// Резонанс для ПК — the sound output: the playback devices Windows has (speakers,
// headphones, a monitor's HDMI…), which one is the default, and making another one
// the default. Listing is plain Core Audio; choosing uses the same call the volume
// flyout makes (the policy interface Windows keeps for it), for all three roles.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Rezonans
{
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IntPtr device);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, IntPtr value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, IntPtr value);
        [PreserveSig] int Commit();
    }

    // the policy interface behind the volume flyout's "Set as default" (Windows 7 to 11)
    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    public class PolicyConfigClient
    {
    }

    [ComImport, Guid("568B9108-44BF-40B4-9006-86AFE5B5A620"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPolicyConfigVista
    {
        // slots 0–8 are other calls of the interface, never used here
        [PreserveSig] int Slot0();
        [PreserveSig] int Slot1();
        [PreserveSig] int Slot2();
        [PreserveSig] int Slot3();
        [PreserveSig] int Slot4();
        [PreserveSig] int Slot5();
        [PreserveSig] int Slot6();
        [PreserveSig] int Slot7();
        [PreserveSig] int Slot8();
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility(IntPtr deviceId, int visible);
    }

    internal static class Outputs
    {
        // PKEY_Device_FriendlyName: "Динамики (Realtek…)"
        private static readonly PROPERTYKEY FriendlyName = new PROPERTYKEY { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 };

        internal static List<Dictionary<string, object>> List()
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                string def = DefaultId(en);
                if (en.EnumAudioEndpoints(0 /* render */, 1 /* active */, out var collPtr) != 0 || collPtr == IntPtr.Zero) return list;
                var coll = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(collPtr);
                Marshal.Release(collPtr);
                coll.GetCount(out uint n);
                for (uint i = 0; i < n; i++)
                {
                    if (coll.Item(i, out var devPtr) != 0 || devPtr == IntPtr.Zero) continue;
                    var dev = (IMMDevice)Marshal.GetObjectForIUnknown(devPtr);
                    Marshal.Release(devPtr);
                    dev.GetId(out var id);
                    list.Add(new Dictionary<string, object>
                    {
                        { "id", id ?? "" },
                        { "name", NameOf(dev) ?? "Устройство вывода" },
                        { "def", id == def },
                    });
                }
            }
            catch (Exception e) { Program.Log("выход звука: " + e.Message); }
            return list;
        }

        private static string DefaultId(IMMDeviceEnumerator en)
        {
            try
            {
                if (en.GetDefaultAudioEndpoint(0, 0 /* console */, out var p) != 0 || p == IntPtr.Zero) return "";
                var d = (IMMDevice)Marshal.GetObjectForIUnknown(p);
                Marshal.Release(p);
                d.GetId(out var id);
                return id ?? "";
            }
            catch { return ""; }
        }

        private static string NameOf(IMMDevice dev)
        {
            IntPtr store = IntPtr.Zero, pv = IntPtr.Zero;
            try
            {
                if (dev.OpenPropertyStore(0 /* read */, out store) != 0 || store == IntPtr.Zero) return null;
                var ps = (IPropertyStore)Marshal.GetObjectForIUnknown(store);
                pv = Marshal.AllocHGlobal(24); // a PROPVARIANT on 64-bit Windows
                var key = FriendlyName;
                if (ps.GetValue(ref key, pv) != 0) return null;
                if (Marshal.ReadInt16(pv) != 31 /* VT_LPWSTR */) return null;
                return Marshal.PtrToStringUni(Marshal.ReadIntPtr(pv, 8));
            }
            catch { return null; }
            finally
            {
                if (pv != IntPtr.Zero) { PropVariantClear(pv); Marshal.FreeHGlobal(pv); }
                if (store != IntPtr.Zero) Marshal.Release(store);
            }
        }

        internal static bool Set(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            try
            {
                var policy = (IPolicyConfigVista)new PolicyConfigClient();
                // console, multimedia and communications: the same device for all three
                for (int role = 0; role < 3; role++) policy.SetDefaultEndpoint(id, role);
                Program.Log("звук: вывод выбран");
                return true;
            }
            catch (Exception e)
            {
                Program.Log("выбор вывода: " + e.Message);
                return false;
            }
        }

        [DllImport("ole32.dll")] private static extern int PropVariantClear(IntPtr pv);
    }
}
