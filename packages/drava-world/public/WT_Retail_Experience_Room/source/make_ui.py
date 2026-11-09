from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import numpy as np, math
A=Path(__file__).resolve().parent/'assets'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(n,b=False):return ImageFont.truetype(BOLD if b else FONT,n)
def drawtext(d,xy,text,n=32,fill='#ebedef',bold=False):d.text(xy,text,font=font(n,bold),fill=fill)
def title(name,kicker,main):
 im=Image.new('RGB',(1800,200),'#080b0f');d=ImageDraw.Draw(im);drawtext(d,(30,16),kicker,26,'#d4ae68');drawtext(d,(26,60),main,89,'#f1f1eb',True);d.line((26,178,1760,178),fill='#7f6639',width=3);im.save(A/name)
title('shoe_title.png','01 / PRODUCT DISCOVERY','NIKE  |  FIND YOUR NEXT MOVE')
title('table_title.png','02 / TANGIBLE INTERACTION','EXPLORE TOGETHER')
# Kiosk product selector, using a procedural side-profile silhouette.
im=Image.new('RGB',(1600,900),'#071015');d=ImageDraw.Draw(im)
drawtext(d,(60,42),'NIKE',48,'white',True);drawtext(d,(1190,55),'PRODUCT EXPLORER',18,'#7e9ca9');drawtext(d,(60,123),'Find your next move.',58,'white',True);drawtext(d,(62,201),'Choose a colorway. Explore the details.',24,'#88a4b0')
colors=['#d5d9d7','#283340','#b23830','#215b92','#74806c','#b99d72'];names=['WHITE','MIDNIGHT','RED','BLUE','OLIVE','SAND']
for i,(c,name) in enumerate(zip(colors,names)):
 x=60+(i%3)*500;y=265+(i//3)*272
 d.rounded_rectangle((x,y,x+470,y+240),radius=22,fill='#15232c',outline='#314852',width=2)
 poly=[(x+62,y+132),(x+61,y+76),(x+91,y+63),(x+122,y+82),(x+150,y+67),(x+200,y+115),(x+281,y+134),(x+367,y+148),(x+385,y+169),(x+365,y+186),(x+78,y+186),(x+59,y+171)]
 d.polygon(poly,fill=c);d.rounded_rectangle((x+59,y+171,x+384,y+189),radius=9,fill='#e0e0d8');d.line((x+172,y+114,x+238,y+139),fill='#b7bdbe',width=7)
 d.polygon([(x+142,y+130),(x+132,y+153),(x+151,y+162),(x+281,y+128),(x+159,y+150)],fill='#faf9f3' if i not in [0,5] else '#202b33')
 drawtext(d,(x+24,y+20),f'0{i+1}',18,'#84abb7');drawtext(d,(x+24,y+203),name,18,'#e1e9ed',True)
drawtext(d,(62,837),'SELECT A SHOE TO BEGIN',19,'#e9665b',True);drawtext(d,(1240,837),'WHITE TUSKER',19,'#8ca4ab');im.save(A/'kiosk_ui.png')
# Multi-touch table UI, aligned with the three physical tokens.
im=Image.new('RGB',(1600,900),'#061217');d=ImageDraw.Draw(im)
for x in range(0,1600,50):d.line((x,0,x,900),fill='#0e252c')
for y in range(0,900,50):d.line((0,y,1600,y),fill='#0e252c')
drawtext(d,(65,45),'TANGIBLE / EXPLORE TOGETHER',38,'#dbe8ec',True);drawtext(d,(65,102),'Place an object. Rotate it. Reveal the story.',23,'#69a7b8')
TW=75*.0254*16/math.sqrt(337);TH=TW*9/16
for i,(dx,dz) in enumerate([(-.51,.10),(.03,-.19),(.51,.15)],1):
 x=int((.5+dx/TW)*1600);y=int((.5+dz/TH)*900)
 for r,col in [(123,'#173a47'),(101,'#235f71'),(80,'#36b2c9')]:d.ellipse((x-r,y-r,x+r,y+r),outline=col,width=3)
 d.line((x+125,y,x+185,y),fill='#3c9db7',width=3);drawtext(d,(max(35,x-103),y+132),f'OBJECT 0{i}',24,'#66bdd0',True)
# Simple isometric exploded-form schematic as illustrative engineering content.
cx,cy=790,620
for k in range(5):
 sy=cy-k*24;poly=[(cx-95,sy),(cx,sy-42),(cx+95,sy),(cx,sy+42),(cx-95,sy)]
 d.line(poly,fill=['#244c5b','#2e6777','#39869a','#55adc1','#a1dee6'][k],width=3)
drawtext(d,(68,793),'PLACE   /   ROTATE   /   DISCOVER',25,'#b7d3dd',True);drawtext(d,(1270,805),'WHITE TUSKER',18,'#86abb8');im.save(A/'table_ui.png')
# Coordinated wall display: 16:9 at native 85-inch geometry.
im=Image.new('RGB',(1920,1080),'#07151d');d=ImageDraw.Draw(im)
drawtext(d,(110,78),'TANGIBLE EXPERIENCE',29,'#59b6c9',True);drawtext(d,(104,172),'Every object',107,'#f1f3ef',True);drawtext(d,(104,294),'opens a story.',107,'#f1f3ef',True)
drawtext(d,(110,459),'Three objects. A shared field of discovery.',36,'#9bb9c4')
for i in range(3):
 x=110+i*574;y=608;d.rounded_rectangle((x,y,x+530,y+310),radius=22,fill='#112a35',outline='#2d5868',width=3)
 d.ellipse((x+205,y+45,x+325,y+165),outline='#50b9cf',width=5);drawtext(d,(x+239,y+69),str(i+1),56,'#edf5f3',True)
 drawtext(d,(x+40,y+207),['PLACE','ROTATE','EXPLORE'][i],32,'#dcebee',True)
drawtext(d,(110,995),'WHITE TUSKER  /  INTERACTIVE EXPERIENCES',23,'#597b8a');im.save(A/'wall_ui.png')
print('Five interface and title textures created.')
