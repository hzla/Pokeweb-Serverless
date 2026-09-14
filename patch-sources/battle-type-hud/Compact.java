import java.nio.file.Files;
import java.nio.file.Path;
import rpm.format.rpm.RPM;
import rpm.format.rpm.RPMSymbol;

/** Remove ELF-local exports that RPMTool otherwise retains as hashed exports.
 * This DLL has no public library ABI: only its relocation targets are needed.
 * Let the standard RPM writer update symbol indices and all section offsets.
 */
public class Compact {
    public static void main(String[] args) throws Exception {
        Path file=Path.of(args[0]);
        RPM rpm=new RPM(Files.readAllBytes(file),"DLXF");
        for(RPMSymbol symbol:rpm.symbols) symbol.setIsExportSymbol(false);
        rpm.strip();
        Files.write(file,rpm.getBytes("DLXF"));
    }
}
