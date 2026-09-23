import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from PIL import Image
import ndspy.texture
SPEC=importlib.util.spec_from_file_location('import_assets',Path(__file__).resolve().parents[1]/'import_assets.py')
IMPORT=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(IMPORT)
class Imports(unittest.TestCase):
    def test_template_conversion_is_deterministic_and_transparent(self):
        frames=[Image.new('RGBA',(32,32),(0,0,0,0)) for _ in range(8)]
        frames[6].putpixel((0,0),(255,0,0,255))
        a=IMPORT.encode(frames);self.assertEqual(a,IMPORT.encode(frames))
        decoded=ndspy.texture.NSBTX(a);image=IMPORT.decode_i4(decoded.textures[6][1],decoded.palettes[0][1])
        self.assertEqual(image.getpixel((0,0)),(255,0,0,255));self.assertEqual(image.getpixel((1,0))[3],0)
    def test_bad_alpha_palette_and_mapping_rejected(self):
        frames=[Image.new('RGBA',(32,32),(0,0,0,128)) for _ in range(8)]
        with self.assertRaises(ValueError):IMPORT.encode(frames)
        with self.assertRaises(ValueError):IMPORT.key_string({'species':650,'form':0,'gender':0,'shiny':False})
    def test_zip_keeps_placeholders_and_writes_nothing_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);key={'species':1,'form':0,'gender':0,'shiny':True}
            (base/'catalog.json').write_text(json.dumps({'entries':[{'key':key}]}))
            Image.new('RGBA',(64,128),(255,0,0,255)).save(base/'art.png')
            manifest={'schemaVersion':1,'entries':[{'key':key,'source':'png','path':'art.png','placeholder':True,'placeholderReason':'Missing shiny art'}]}
            path=base/'import.json';path.write_text(json.dumps(manifest));output=base/'out.zip'
            IMPORT.convert(path,base/'catalog.json',output);a=output.read_bytes();IMPORT.convert(path,base/'catalog.json',output);self.assertEqual(a,output.read_bytes())
            with zipfile.ZipFile(output) as archive:self.assertTrue(json.loads(archive.read('manifest.json'))['entries'][0]['placeholder'])
            manifest['entries'].append(manifest['entries'][0]);path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):IMPORT.convert(path,base/'catalog.json',output)
            self.assertEqual(a,output.read_bytes())
    def test_hg_engine_preserves_palette_indices_and_explicit_frame_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);im=Image.new('P',(32,256));im.putpixel((0,32*7),1);im.save(base/'art.png')
            frames={str(i):{'frame':i,'width':32,'height':32,'format':3,'color0':1} for i in range(8)}
            (base/'art.json').write_text(json.dumps({'frames':frames}))
            (base/'shiny.pal').write_text('JASC-PAL\n0100\n16\n'+'\n'.join(['255 0 255','0 255 0']+['0 0 0']*14))
            entry={'source':'hg-engine','path':'art.png','metadata':'art.json','palette':'shiny.pal','frameIndices':[7,6,5,4,3,2,1,0]}
            result=IMPORT.frames_from_entry(entry,base)
            self.assertEqual(result[0].getpixel((0,0)),(0,255,0,255));self.assertEqual(result[0].getpixel((1,0))[3],0)
    def test_hgss_uses_explicit_palette_and_indices(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);frames=[Image.new('RGBA',(32,32),(0,0,0,0)) for _ in range(8)];frames[7].putpixel((0,0),(0,0,255,255))
            (base/'art.btx').write_bytes(IMPORT.encode(frames))
            result=IMPORT.frames_from_entry({'source':'hgss','path':'art.btx','paletteIndex':0,'frameIndices':[7,6,5,4,3,2,1,0]},base)
            self.assertEqual(result[0].getpixel((0,0)),(0,0,255,255))
if __name__=='__main__':unittest.main()
