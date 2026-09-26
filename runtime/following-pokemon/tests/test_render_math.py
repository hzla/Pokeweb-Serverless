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
  cls.lib.fwr_above_shadow.argtypes=[c.POINTER(Pose),c.POINTER(Point),c.POINTER(Camera),c.POINTER(Pose)]
  cls.lib.fwr_player_in_front.argtypes=[c.POINTER(Pose),c.POINTER(Pose),c.POINTER(Camera),Point,c.c_int32,c.c_int32,c.POINTER(Pose),c.POINTER(c.c_int32)]
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
 def test_north_follower_keeps_previous_foreground_depth(self):
  eye=(0,760739,581835);cam=Camera(Point(*eye),Point(),0)
  world=Point(0,0,65536)
  # The new north-facing native anchor moved seven Z units, and the artwork
  # moved two additional Y units. Restore the previous *depth*, not its pixels.
  old=Pose(Point(0,-6*4096,65536-2*4096),8192,8192)
  current=Pose(Point(0,-8*4096,65536-9*4096),8192,8192)
  _,_,old_result=self.run_case(world,old,cam,0)
  applied,out,result=self.run_case(world,current,cam,2)
  self.assertTrue(applied);self.assertEqual(result.policy,1)
  self.assertGreaterEqual(result.after,old_result.before)
  self.assertLess(result.after-old_result.before,128)
  before=project(current,eye,False);after=project(out,eye,False)
  self.assertLess(max(abs(x-y)for a,b in zip(before,after)for x,y in zip(a,b)),0.002/256)
  # Lateral and unequal-height policies do not opt into the north repair.
  _,_,side=self.run_case(world,current,cam,0)
  self.assertLess(side.after,result.after)
  upper=Point(0,65536,65536)
  _,_,stairs=self.run_case(upper,current,cam,3)
  _,_,prior_stairs=self.run_case(upper,current,cam,1)
  self.assertEqual((stairs.policy,stairs.after),(prior_stairs.policy,prior_stairs.after))
 def test_billboard_stays_in_front_of_shadow_without_moving_on_screen(self):
  # The supplied mounted Reuniclus state has its player shadow at this world
  # point and the submitted mount below that ground plane.
  ground=Point(2916352,65551,49381376)
  eye=Point(2916352,842674,49963211);target=Point(2916352,81935,49381376)
  pose=Pose(Point(2916352,59067-5*4096,49381376),8192,8192)
  for projection in (0,1,2):
   cam=Camera(eye,target,projection);out=Pose()
   self.assertEqual(self.lib.fwr_above_shadow(c.byref(pose),c.byref(ground),c.byref(cam),c.byref(out)),1)
   axis=[eye.x-target.x,eye.y-target.y,eye.z-target.z];n=math.sqrt(dot(axis,axis));axis=[x/n for x in axis]
   offset=[xyz(out.position)[i]-xyz(ground)[i] for i in range(3)]
   self.assertGreaterEqual(dot(offset,axis),6*4096-32)
   local_eye=tuple(x-y for x,y in zip(xyz(eye),xyz(target)))
   local_pose=Pose(Point(*(x-y for x,y in zip(xyz(pose.position),xyz(target)))),pose.sx,pose.sy)
   local_out=Pose(Point(*(x-y for x,y in zip(xyz(out.position),xyz(target)))),out.sx,out.sy)
   before=project(local_pose,local_eye,projection==2);after=project(local_out,local_eye,projection==2)
   self.assertLess(max(abs(x-y)for a,b in zip(before,after)for x,y in zip(a,b)),4 if projection==2 else 0.002/256)
   again=Pose();self.assertEqual(self.lib.fwr_above_shadow(c.byref(out),c.byref(ground),c.byref(cam),c.byref(again)),0)
   self.assertEqual(bytes(out),bytes(again))
 def test_south_follower_shadow_clearance_cannot_reverse_player_priority(self):
  # walkdown.mln: Arceus is one tile north of the player. Its -5 Y artwork
  # offset put it safely behind, then the +6 shadow clearance put it in front.
  # Rebase the saved world coordinates so fixed-point arithmetic is identical.
  world=Point(0,0,-16*4096);player=Point();player_draw=Point(0,-6484,0)
  artwork=Pose(Point(0,-340-5*4096,-12*4096),16384,16384)
  ground=Point(0,0,-10*4096)
  eye=(0,760739,581835)
  for projection in (0,1,2):
   cam=Camera(Point(*eye),Point(),projection)
   ordered=Pose();result=Result()
   self.lib.fwr_correct(c.byref(world),c.byref(player),c.byref(artwork),c.byref(player_draw),c.byref(cam),1,c.byref(ordered),c.byref(result))
   self.assertEqual(result.policy,-1)
   raised=Pose();self.assertEqual(self.lib.fwr_above_shadow(c.byref(ordered),c.byref(ground),c.byref(cam),c.byref(raised)),1)
   direction=xyz(result.axis)
   depth=lambda pose:math.trunc(sum((a-b)*n for a,b,n in zip(xyz(raised.position),xyz(pose.position),direction))/4096)
   player_pose=Pose(player_draw,8192,8192)
   self.assertGreater(depth(player_pose),0) # The supplied frame's regression.
   foreground=Pose();final=c.c_int32()
   self.assertEqual(self.lib.fwr_player_in_front(c.byref(raised),c.byref(player_pose),c.byref(cam),result.axis,12*4096,32*4096,c.byref(foreground),c.byref(final)),1)
   self.assertLessEqual(final.value,-12*4096)
   self.assertEqual(final.value,depth(foreground))
   before=project(player_pose,eye,projection==2);after=project(foreground,eye,projection==2)
   self.assertLess(max(abs(x-y)for a,b in zip(before,after)for x,y in zip(a,b)),4 if projection==2 else 0.002/256)
   unchanged=Pose();self.assertEqual(self.lib.fwr_player_in_front(c.byref(raised),c.byref(foreground),c.byref(cam),result.axis,12*4096,32*4096,c.byref(unchanged),c.byref(final)),0)
   self.assertEqual(bytes(foreground),bytes(unchanged))
if __name__=='__main__':unittest.main()
