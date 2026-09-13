// Compile against .NET Framework/Mono, then run under Wine with the installed
// FrostsGen5Editor.exe. This exercises Frost's real parsers and ROM writer.
using System;
using System.Collections;
using System.IO;
using System.Reflection;

class VerifyFrostRoundtrip {
    [STAThread]
    static int Main(string[] args) {
        if (args.Length != 3) throw new ArgumentException("FrostsGen5Editor.exe input.nds new-output.nds");
        var assemblyPath = Path.GetFullPath(args[0]);
        AppDomain.CurrentDomain.AssemblyResolve += (sender, e) => {
            var path = Path.Combine(Path.GetDirectoryName(assemblyPath), new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };
        var assembly = Assembly.LoadFrom(assemblyPath);
        var type = assembly.GetType("NewEditor.Data.NDSFileSystem", true);
        object system;
        using (var input = File.OpenRead(args[1])) {
            system = type.GetMethod("FromRom").Invoke(null, new object[] { input, true });
        }
        var moves = type.GetField("moveDataNarc").GetValue(system);
        var entries = (IList)moves.GetType().GetField("moves").GetValue(moves);
        var pound = entries[1];
        var power = pound.GetType().GetField("basePower");
        var old = (byte)power.GetValue(pound);
        power.SetValue(pound, (byte)(old == 41 ? 42 : 41));
        pound.GetType().GetMethod("ApplyData", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(pound, null);
        Console.WriteLine("Frost parsed all archives; edited Pound power " + old + " -> " + power.GetValue(pound));
        var bytes = (byte[])type.GetMethod("BuildRom").Invoke(system, null);
        using (var output = new FileStream(args[2], FileMode.CreateNew)) output.Write(bytes, 0, bytes.Length);
        using (var input = File.OpenRead(args[2])) type.GetMethod("FromRom").Invoke(null, new object[] { input, true });
        Console.WriteLine("Frost saved and reopened its edited ROM successfully.");
        return 0;
    }
}
