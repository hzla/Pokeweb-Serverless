"""Independent projection checks, using host C with the same fixed-point math."""
import ctypes as c, math, subprocess, tempfile, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]
class Point(c.Structure):_fields_=[('x',c.c_int32),('y',c.c_int32),('z',c.c_int32)]
class Camera(c.Structure):_fields_=[('eye',Point),('target',Point),('projection',c.c_uint32)]
class Pose(c.Structure):_fields_=[('position',Point),('sx',c.c_int32),('sy',c.c_int32)]
class Result(c.Structure):_fields_=[('axis',Point),('before',c.c_int32),('after',c.c_int32),('policy',c.c_int32)]
def xyz(p):return (p.x,p.y,p.z)
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def project(pose,eye,ortho):
 n=[x/math.sqrt(dot(eye,eye)) for x in eye];r=[n[2],0,-n[0]];length=math.sqrt(dot(r,r));r=[x/length for x in r]
 up=[n[1]*r[2],n[2]*r[0]-n[0]*r[2],-n[1]*r[0]]
 # Sign of vertical axis is irrelevant to equality; compare all quad corners.
 out=[]
 for x,y in [(-1,0),(1,0),(-1,2),(1,2)]:
  point=[xyz(pose.position)[i]+r[i]*x*pose.sx+up[i]*y*pose.sy for i in range(3)]
  v=[point[i]-eye[i] for i in range(3)];depth=-dot(v,n)
  out.append((dot(v,r)/(1 if ortho else depth),dot(v,up)/(1 if ortho else depth)))
 return out
class Rendering(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();lib=Path(cls.tmp.name)/'render.so'
  subprocess.run(['cc','-shared','-fPIC','-std=c11','-Wall','-Wextra','-Werror',str(HERE/'render_math.c'),'-o',str(lib)],check=True)
  cls.lib=c.CDLL(str(lib));cls.lib.fwr_correct.argtypes=[c.POINTER(Point),c.POINTER(Point),c.POINTER(Pose),c.POINTER(Point),c.POINTER(Camera),c.c_uint,c.POINTER(Pose),c.POINTER(Result)]
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def run_case(self,world,pose,cam,large=1):
  out=Pose();res=Result();p=Point();applied=self.lib.fwr_correct(c.byref(world),c.byref(p),c.byref(pose),c.byref(p),c.byref(cam),large,c.byref(out),c.byref(res));return applied,out,res
 def test_projection_and_order(self):
  cases=0
  for size in (8192,16384):
   for projection in (0,1,2):
    for yaw in range(0,360,15):
     for pitch in (20,35,45,52.58,65,75):
      y,p=map(math.radians,(yaw,pitch));eye=tuple(int(v*240*4096)for v in (math.sin(y)*math.cos(p),math.sin(p),math.cos(y)*math.cos(p)))
      cam=Camera(Point(*eye),Point(),projection)
      world=Point(int(math.cos(y)*65536),0,int(-math.sin(y)*65536))
      for bob in (0,6144):
       pose=Pose(Point(world.x,bob,world.z),size,size);applied,out,res=self.run_case(world,pose,cam,size==16384)
       self.assertTrue(applied);self.assertLessEqual(res.after,-508)
       before=project(pose,eye,projection==2);after=project(out,eye,projection==2)
       # Ortho: <1/1000 world unit of projected drift. Perspective: <0.002
       # pixels at focal length 256, allowing fx16 quad-size quantization.
       error=max(abs(x-y)for a,b in zip(before,after)for x,y in zip(a,b))
       self.assertLess(error,4 if projection==2 else 0.002/256)
       cases+=1
  self.assertEqual(cases,1728)
 def test_reject_bad_camera_and_discontinuities(self):
  for cam in [Camera(Point(),Point(),0),Camera(Point(0,1000000,1000000),Point(),3),Camera(Point(2147483647,0,0),Point(-2147483648,0,0),0)]:
   pose=Pose(Point(65536,6144,0),8192,8192);applied,out,res=self.run_case(Point(65536,0,0),pose,cam)
   self.assertEqual(applied,0);self.assertEqual(bytes(pose),bytes(out))
 def test_stair_policy_does_not_depend_on_bob(self):
  cam=Camera(Point(0,760739,581835),Point(),0)
  for y,policy in [(65536,0),(-32740,-2)]:
   for bob in (0,6144):
    world=Point(65536,y,0);pose=Pose(Point(57344,y+bob,-8192),16384,16384)
    applied,out,res=self.run_case(world,pose,cam)
    self.assertEqual(res.policy,policy)
    if not policy:self.assertEqual(bytes(out),bytes(pose))
if __name__=='__main__':unittest.main()
