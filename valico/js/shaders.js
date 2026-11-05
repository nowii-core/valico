'use strict';
/* Valico — shader GLSL ES 3.0 (WebGL2). L'intestazione (#version, precisioni, #define) la aggiunge program(). */

const SH = {};

SH.common = `
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uCamF;
uniform float uTime;
uniform vec3 uL;
uniform vec3 uLCol;
uniform vec3 uAmbT;
uniform vec3 uAmbB;
uniform vec3 uFogCol;
uniform vec3 uSunGlow;
uniform vec3 uSunDir;
uniform float uFogDen;
uniform float uWeather;
uniform float uSnow;
uniform float uWindAmt;
uniform vec4 uFire[4];
uniform vec4 uLamp;
uniform float uWorldHalf;
uniform float uShMix;
uniform float uExposure;
uniform vec4 uHut;
uniform float uHutY;
`;

/* ---------- Rumore, bump, ombre, luce, nebbia ---------- */
SH.fragLib = `
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),f.x),mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),f.x),f.y); }
float gn(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=dot(hash22(i)*2.0-1.0,f);
  float b=dot(hash22(i+vec2(1.0,0.0))*2.0-1.0,f-vec2(1.0,0.0));
  float c=dot(hash22(i+vec2(0.0,1.0))*2.0-1.0,f-vec2(0.0,1.0));
  float d=dot(hash22(i+vec2(1.0,1.0))*2.0-1.0,f-vec2(1.0,1.0));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4142+0.5;
}
float fbm2(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.3); a*=0.5; } return s; }
/* fbm con anti-aliasing: le ottave piu' fini della dimensione del pixel svaniscono (fw = pixel in unita' p) */
float fbmF(vec2 p,int oct,float fw){
  float s=0.0,a=0.5,f=1.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    float w=1.0-smoothstep(0.25,0.8,fw*f);
    s+=a*w*(gn(p*f+float(i)*vec2(17.1,9.3))-0.5);
    f*=2.02; a*=0.5;
  }
  return s+0.5;
}
float ridgedF(vec2 p){ return 1.0-abs(2.0*gn(p)-1.0); }
/* bump mapping su superfici arbitrarie (derivate a schermo) */
vec3 bump(vec3 N, vec3 wp, float h, float k){
  vec3 dpx=dFdx(wp), dpy=dFdy(wp);
  float dhx=dFdx(h), dhy=dFdy(h);
  vec3 r1=cross(dpy,N), r2=cross(N,dpx);
  float det=dot(dpx,r1);
  vec3 g=sign(det)*(dhx*r1+dhy*r2);
  return normalize(abs(det)*N-k*g);
}

uniform sampler2D uShA;
uniform sampler2D uShB;
uniform sampler2DArrayShadow uSMap;
uniform mat4 uSM[3];
uniform vec3 uSplit;
uniform vec3 uTexelW;
uniform vec3 uSMRange;
uniform float uShOn;
uniform float uShTaps;
vec2 shadowAt(vec3 wp){
  vec2 uv=(wp.xz+uWorldHalf)/(2.0*uWorldHalf);
  return mix(texture(uShA,uv).rg,texture(uShB,uv).rg,uShMix);
}
const vec2 PD[8]=vec2[8](vec2(-0.613,0.617),vec2(0.170,-0.040),vec2(-0.299,-0.795),vec2(0.645,0.493),
                         vec2(-0.651,0.054),vec2(0.421,0.879),vec2(0.743,-0.411),vec2(-0.043,0.390));
float csm(vec3 wp, vec3 n){
  if(uShOn<0.5) return 1.0;
  float d=dot(wp-uCam,uCamF);
  int c=-1;
  if(d<uSplit.x) c=0; else if(d<uSplit.y) c=1; else if(d<uSplit.z) c=2;
  if(c<0) return 1.0;
  float tw=uTexelW[c];
  vec3 p=wp+n*tw*2.2;
  vec4 sc=uSM[c]*vec4(p,1.0);
  vec3 q=sc.xyz*0.5+0.5;
  if(q.x<0.0||q.y<0.0||q.x>1.0||q.y>1.0||q.z>1.0) return 1.0;
  float ang=hash12(gl_FragCoord.xy)*6.2831853;
  vec2 cs=vec2(cos(ang),sin(ang));
  mat2 rot=mat2(cs.x,-cs.y,cs.y,cs.x);
  float rad=1.7/float(textureSize(uSMap,0).x);
  float bias=tw*1.3/uSMRange[c];
  float vis=0.0;
  int taps=int(uShTaps);
  for(int i=0;i<8;i++){
    if(i>=taps) break;
    vis+=texture(uSMap,vec4(q.xy+rot*PD[i]*rad,float(c),q.z-bias));
  }
  vis/=float(taps);
  return mix(vis,1.0,smoothstep(uSplit.z*0.82,uSplit.z,d));
}
float hutAO(vec3 wp){
  vec2 d=abs(wp.xz-uHut.xy);
  float inside=step(d.x,uHut.z)*step(d.y,uHut.w)*step(wp.y,uHutY+2.5)*step(uHutY-0.3,wp.y);
  return mix(1.0,0.2,inside);
}
vec3 lightingS(vec3 alb, vec3 n, vec3 wp, float ao, float sh, float sstr, float spow){
  float ndl=max(dot(n,uL),0.0);
  vec3 col=alb*(uLCol*ndl*sh + mix(uAmbB,uAmbT,n.y*0.5+0.5)*ao);
  if(sstr>0.0){
    vec3 V=normalize(uCam-wp); vec3 H=normalize(uL+V);
    col+=uLCol*sh*sstr*pow(max(dot(n,H),0.0),spow)*step(0.0,ndl);
  }
  for(int i=0;i<4;i++){
    float inten=uFire[i].w;
    if(inten>0.001){
      vec3 d=uFire[i].xyz-wp; float dist=length(d); vec3 dn=d/max(dist,0.001);
      float att=inten/(1.0+dist*dist*0.22);
      float fl=0.86+0.1*sin(uTime*11.0+float(i)*5.0)+0.06*sin(uTime*27.0+float(i));
      col+=alb*vec3(1.0,0.5,0.2)*att*(max(dot(n,dn),0.0)*0.85+0.15)*fl*5.0;
    }
  }
  if(uLamp.w>0.01){
    vec3 d=uCam-wp; float dist=length(d); vec3 dn=d/max(dist,0.001);
    float cone=smoothstep(0.84,0.95,dot(-dn,uCamF));
    float att=cone/(1.0+dist*dist*0.01);
    col+=alb*vec3(1.0,0.95,0.86)*att*max(dot(n,dn),0.0)*5.5*uLamp.w*(0.4+0.6*ao);
  }
  return col;
}
vec3 lighting(vec3 alb, vec3 n, vec3 wp, float ao, float sh){ return lightingS(alb,n,wp,ao,sh,0.0,1.0); }
vec3 applyFog(vec3 col, vec3 wp){
  vec3 v=wp-uCam; float dist=length(v); vec3 vd=v/max(dist,0.001);
  float dens=uFogDen*(1.0+uWeather*6.0);
  float hf=exp(-max(wp.y-30.0,0.0)*0.0035);
  float f=1.0-exp(-dist*dens*(0.35+0.65*hf));
  float sg=pow(max(dot(vd,uSunDir),0.0),5.0);
  vec3 fc=mix(uFogCol,vec3(dot(uFogCol,vec3(0.33)))*vec3(0.92,0.98,1.1),0.35)+uSunGlow*sg*(1.0-uWeather*0.6);
  return mix(col,fc,clamp(f,0.0,1.0));
}
vec3 acesTone(vec3 c){ c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14); return clamp(c,0.0,1.0); }
vec4 outc(vec3 c,float a){
#ifdef HDR
  return vec4(c,a);
#else
  return vec4(pow(acesTone(c*uExposure),vec3(1.0/2.2)),a);
#endif
}
`;

SH.skyLib = `
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uMoonDir;
uniform vec3 uSunCol;
uniform float uNight;
uniform float uSunVis;
vec3 skyBasic(vec3 r){
  float y=max(r.y,0.0);
  vec3 s=mix(uSkyHor,uSkyZen,pow(y,0.5));
  float sd=max(dot(r,uSunDir),0.0);
  s+=uSunCol*uSunVis*(pow(sd,6.0)*0.06+pow(sd,48.0)*0.25);
  float md=max(dot(r,uMoonDir),0.0);
  s+=vec3(0.5,0.6,0.9)*uNight*pow(md,64.0)*0.12;
  s=mix(s,vec3(dot(s,vec3(0.33)))*0.8,uWeather*0.7);
  return s;
}
`;

/* ---------- Cielo ---------- */
SH.skyVS = SH.common + `
out vec2 vUV;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUV=p*2.0-1.0;
  gl_Position=vec4(vUV,0.0,1.0);
}`;
SH.skyFS = SH.common + SH.fragLib + SH.skyLib + `
in vec2 vUV;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec2 uTanAsp;
out vec4 oc;
void main(){
  vec3 r=normalize(uCamF+uCamR*vUV.x*uTanAsp.x*uTanAsp.y+uCamU*vUV.y*uTanAsp.x);
  vec3 col=skyBasic(r);
  float cd=0.0;
  if(r.y>0.0){
    float up=max(r.y,0.0);
    vec2 cuv=r.xz/(up+0.14)*0.85+vec2(uTime*0.012*(1.0+uWeather*3.0),uTime*0.006);
    float cn=fbm2(cuv*1.1)*0.65+fbm2(cuv*3.3+5.0)*0.35;
    float cover=0.36+uWeather*0.6;
    cd=smoothstep(1.0-cover-0.16,1.0-cover+0.2,cn)*smoothstep(0.0,0.14,up);
    float sd=max(dot(r,uSunDir),0.0);
    vec3 cc=(uAmbT*1.15+uLCol*0.14*(0.55+0.45*smoothstep(0.35,0.8,cn)))*mix(1.0,0.5,uWeather);
    cc+=uLCol*0.22*pow(sd,8.0)*(1.0-cd*0.4)*(1.0-uWeather);
    col=mix(col,cc,cd*0.94);
    vec3 sp=r*190.0; vec3 ci=floor(sp);
    float h=fract(sin(dot(ci,vec3(12.9898,78.233,45.164)))*43758.5453);
    float st=step(0.9972,h)*(0.4+0.6*fract(h*91.7));
    col+=vec3(0.85,0.9,1.0)*st*uNight*(1.0-cd)*(1.0-uWeather)*smoothstep(0.02,0.2,r.y)*1.4;
    float md=dot(r,uMoonDir);
    col+=vec3(0.9,0.94,1.0)*smoothstep(0.99935,0.99975,md)*uNight*(1.0-cd*0.9)*(1.0-uWeather*0.8)*2.2;
    col+=uSunCol*smoothstep(0.99955,0.99985,sd)*uSunVis*(1.0-cd*0.85)*7.0;
  }
  col=mix(col,uFogCol,smoothstep(0.0,-0.08,r.y));
  oc=outc(col,1.0);
}`;

/* ---------- Terreno ---------- */
SH.terrainVS = SH.common + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
out vec3 vWp; out vec3 vN;
void main(){ vWp=aPos; vN=aNrm; gl_Position=uVP*vec4(aPos,1.0); }`;

SH.terrainFS = SH.common + SH.fragLib + `
in vec3 vWp; in vec3 vN;
out vec4 oc;
void main(){
  vec3 N0=normalize(vN);
  vec3 wp=vWp; vec2 p=wp.xz;
  float slope=1.0-N0.y, alt=wp.y;
  float dist=length(uCam-wp);
  vec2 f2=fwidth(p); float fw=max(f2.x,f2.y)+1e-4;
  float m0=fbmF(p*0.0042,3,fw*0.0042);
  float m1=fbmF(p*0.021+vec2(40.0,11.0),3,fw*0.021);
  float h1=fbmF(p*0.42,4,fw*0.42);
  float h2=fbmF(p*1.9,3,fw*1.9);
  float h3=fbmF(p*8.0,3,fw*8.0);

  float rockM=smoothstep(0.2,0.42,slope+(m1-0.5)*0.2);
  float gM=(1.0-smoothstep(0.28,0.46,slope+(m1-0.5)*0.2))*(1.0-smoothstep(105.0,165.0,alt+(m0-0.5)*70.0));

  /* roccia: triplanare su due piani + stratificazione */
  vec3 rock=vec3(0.22); float rockH=0.0;
  vec3 an=pow(abs(N0),vec3(4.0)); an/=(an.x+an.y+an.z);
  vec2 pa=vec2(wp.z,wp.y), pb=vec2(wp.x,wp.y);
  vec2 fa2=fwidth(pa), fb2=fwidth(pb);
  float fa=max(fa2.x,fa2.y)+1e-4, fb=max(fb2.x,fb2.y)+1e-4;
  float fwr=max(fa*an.x+fb*an.z+fw*an.y,fw);
  if(slope>0.12||alt>110.0){
    float rk=an.x*fbmF(pa*0.16,4,fa*0.16)+an.z*fbmF(pb*0.16,4,fb*0.16)+an.y*fbmF(p*0.16,4,fw*0.16);
    float rk2=an.x*fbmF(pa*0.9,3,fa*0.9)+an.z*fbmF(pb*0.9,3,fb*0.9)+an.y*fbmF(p*0.9,3,fw*0.9);
    float st=wp.y*0.28+(rk-0.5)*2.4+(m0-0.5)*4.0;
    float band=0.5+0.5*sin(st*6.2831);
    vec3 r1=vec3(0.26,0.255,0.25), r2=vec3(0.18,0.17,0.16), r3=vec3(0.085,0.088,0.095), r4=vec3(0.30,0.285,0.26);
    rock=mix(r1,r2,band);
    rock=mix(rock,r3,smoothstep(0.55,0.85,rk));
    rock=mix(rock,r4,smoothstep(0.62,0.9,rk2)*0.4);
    vec2 pc=mix(pa,pb,step(an.x,an.z));
    float crack=smoothstep(0.8,0.96,ridgedF(pc*0.34))*(1.0-smoothstep(0.2,0.7,fwr*0.34));
    rock*=1.0-0.62*crack;
    rock*=0.8+0.4*rk2;
    float lich=smoothstep(0.7,0.86,fbmF(pc*1.3,1,fwr*1.3))*smoothstep(0.1,0.3,slope)*0.5;
    rock=mix(rock,vec3(0.24,0.26,0.1),lich*(1.0-smoothstep(120.0,260.0,alt)));
    float scree=smoothstep(0.26,0.34,slope)*(1.0-smoothstep(0.44,0.55,slope))*step(100.0,alt);
    rock=mix(rock,vec3(0.2,0.19,0.18)*(0.6+0.8*fbmF(p*11.0,2,fwr*11.0)),scree*0.7);
    float streak=fbmF(vec2(mix(pa.x,pb.x,step(an.x,an.z))*0.9,wp.y*0.045),3,fwr*0.9);
    rock*=0.62+0.75*streak;
    rock=mix(rock,vec3(dot(rock,vec3(0.33))),0.35);
    rockH=rk*0.9+rk2*0.45-crack*0.6;
  }

  /* prato */
  vec3 g1=vec3(0.095,0.150,0.036), g2=vec3(0.190,0.225,0.064), g3=vec3(0.215,0.18,0.085);
  vec3 grass=mix(g1,g2,smoothstep(0.3,0.7,m1+(h2-0.5)*0.5));
  grass=mix(grass,g3,smoothstep(0.55,0.85,m0+(h3-0.5)*0.4)*0.6);
  grass*=0.7+0.6*h2;
  vec3 soil=vec3(0.098,0.072,0.05)*(0.7+0.6*h2);
  grass=mix(grass,soil,smoothstep(0.62,0.8,m1+(h2-0.5)*0.3)*0.55);
  grass*=mix(0.8,1.0,smoothstep(6.0,34.0,dist));   /* sotto i fili d'erba */

  vec3 alb=mix(rock,grass,gM);
  float shore=1.0-smoothstep(0.0,2.6,alt+h1*1.5);
  alb=mix(alb,vec3(0.3,0.27,0.22)*(0.65+0.7*h3),shore*0.9);
  alb*=mix(1.0,0.55,1.0-smoothstep(0.0,1.2,alt-0.3));

  float snowLine=mix(330.0,12.0,uSnow);
  float sm=smoothstep(snowLine-20.0,snowLine+25.0,alt+m0*55.0-slope*120.0+(h1-0.5)*30.0)*(1.0-smoothstep(0.52,0.9,slope));
  alb=mix(alb,vec3(0.82,0.86,0.92)*(0.9+0.1*h3),sm);

  float hb=mix(rockH*0.55,(h1*0.45+h2*0.3+h3*0.12)*0.28,gM);
  hb=mix(hb,(h2*0.2+h3*0.08)*0.5,sm);
  vec3 N=bump(N0,wp,hb,1.0);
  N=normalize(mix(N,N0,sm*0.5));

  vec2 s=shadowAt(wp);
  float sh=min(s.r,csm(wp,N0));
  float ao=s.g*(0.75+0.25*h2);
  vec3 col=lightingS(alb,N,wp,ao,sh,sm*0.7+shore*0.25,mix(30.0,90.0,sm));
  col=applyFog(col,wp);
  oc=outc(col,1.0);
}`;

/* ---------- Oggetti statici (rifugio, segnavia, casse) ---------- */
SH.propVS = SH.common + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aMat;
out vec3 vWp; out vec3 vN; out vec3 vCol; out vec2 vMat;
void main(){ vWp=aPos; vN=aNrm; vCol=aCol; vMat=aMat; gl_Position=uVP*vec4(aPos,1.0); }`;

SH.propLib = `
/* materiali procedurali: restituisce albedo, altezza per il bump, intensita' speculare */
void material(float type, vec3 wp, inout vec3 alb, out float h, out float spec){
  h=0.0; spec=0.0;
  vec2 f2=fwidth(wp.xz+wp.y); float fw=max(f2.x,f2.y)+1e-4;
  if(type>0.5&&type<1.5){                    /* legno: venature */
    float g=fbmF(vec2(wp.y*26.0+wp.x*0.5,(wp.x+wp.z)*1.6),3,fw*8.0);
    float g2=gn(vec2(wp.y*110.0,(wp.x+wp.z)*4.0));
    alb*=0.62+0.8*g; alb*=0.9+0.2*mix(1.0,g2,1.0-smoothstep(0.003,0.02,fw));
    h=g*0.012+g2*0.003; spec=0.12;
  } else if(type>1.5&&type<2.5){             /* pietra */
    float g=fbmF(wp.xz*5.0+wp.y*4.0,4,fw*5.0), g2=fbmF(wp.xz*22.0+wp.y*14.0,3,fw*22.0);
    alb*=0.55+0.9*g; alb*=0.85+0.3*g2;
    h=g*0.03+g2*0.01; spec=0.06;
  } else if(type>2.5&&type<3.5){
    alb*=0.65+0.7*gn(wp.xz*9.0+wp.y*7.0);
  } else if(type>3.5&&type<4.5){             /* tegole */
    float rw=wp.y*9.0, row=floor(rw);
    float col=floor(wp.z*5.5+0.5*mod(row,2.0));
    float rnd=hash12(vec2(row,col));
    float fr=fract(rw);
    alb*=0.6+0.8*rnd; alb*=0.7+0.3*smoothstep(0.0,0.35,fr);
    float cx=abs(fract(wp.z*5.5+0.5*mod(row,2.0))-0.5)*2.0;
    h=smoothstep(0.0,0.5,fr)*0.03-smoothstep(0.88,1.0,cx)*0.02+rnd*0.01; spec=0.05;
  } else if(type>4.5&&type<5.5){             /* metallo scuro */
    alb*=0.8+0.4*gn(wp.xz*30.0+wp.y*20.0); spec=0.5;
  } else if(type>5.5&&type<6.5){             /* tessuto */
    float w=gn(vec2(wp.x*90.0+wp.z*90.0,wp.y*90.0))*0.5+gn(vec2(wp.z*80.0-wp.x*80.0,wp.y*80.0))*0.5;
    alb*=0.75+0.4*w; h=w*0.004;
  }
}
`;

SH.propFS = SH.common + SH.fragLib + SH.propLib + `
in vec3 vWp; in vec3 vN; in vec3 vCol; in vec2 vMat;
out vec4 oc;
void main(){
  vec3 N0=normalize(vN);
  vec3 alb=vCol;
  float type=vMat.y;
  vec3 col;
  if(type>8.5){
    float flick=0.55+0.45*gn(vec2(uTime*3.0,vWp.x*2.0+vWp.z));
    float mull=1.0-0.6*(1.0-smoothstep(0.01,0.03,abs(fract(vWp.y*6.0)-0.5)))*0.0;
    col=alb*(2.4+0.5*flick)*mull;
  } else {
    float h, spec;
    material(type,vWp,alb,h,spec);
    vec3 N=bump(N0,vWp,h,1.0);
    float sn=uSnow*smoothstep(0.5,0.9,N0.y)*step(type,7.5);
    alb=mix(alb,vec3(0.84,0.87,0.93),sn);
    vec2 s=shadowAt(vWp);
    float sh=min(s.r,csm(vWp,N0));
    float ao=hutAO(vWp)*(type>2.5&&type<3.5?1.0:1.0);
    float bk=s.g*0.5+0.5;
    col=lightingS(alb,N,vWp,ao*mix(1.0,bk,0.0),sh,spec+sn*0.4,40.0);
    if(vMat.x>0.0){
      vec3 d=uCam-vWp; float dist=length(d);
      float cone=smoothstep(0.78,0.96,dot(-d/dist,uCamF))*uLamp.w;
      col+=alb*vMat.x*(cone*24.0/(1.0+dist*0.04)+0.06);
    }
  }
  col=applyFog(col,vWp);
  oc=outc(col,1.0);
}`;

/* ---------- Pini (istanziati). LOD lontano: stesso mesh basso con shader prop ---------- */
SH.treeLowVS = SH.common + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=4) in vec4 iA;
layout(location=5) in vec2 iB;
out vec3 vWp; out vec3 vN; out vec3 vCol; out vec2 vMat;
void main(){
  float c=cos(iB.x), s=sin(iB.x);
  vec3 p=aPos*iA.w;
  p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  vec3 n=vec3(c*aNrm.x+s*aNrm.z,aNrm.y,-s*aNrm.x+c*aNrm.z);
  float h=aPos.y/9.0;
  float sway=sin(uTime*(1.2+uWindAmt)+iB.y*6.28+iA.x*0.07)*(0.015+0.07*uWindAmt)*h*h*iA.w*3.0;
  vWp=iA.xyz+p+vec3(sway,0.0,sway*0.6);
  vN=n;
  vCol=aCol*(0.8+0.4*iB.y);
  vMat=vec2(0.0,3.0);
  gl_Position=uVP*vec4(vWp,1.0);
}`;

SH.treeVS = SH.common + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aMat;
layout(location=4) in vec4 iA;
layout(location=5) in vec2 iB;
out vec3 vWp; out vec3 vN; out vec3 vCol; out vec2 vUV; out vec3 vObj; out float vSeed;
void main(){
  float c=cos(iB.x), s=sin(iB.x);
  vec3 p=aPos*iA.w;
  p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  vec3 n=vec3(c*aNrm.x+s*aNrm.z,aNrm.y,-s*aNrm.x+c*aNrm.z);
  float h=aPos.y/9.0;
  float ph=uTime*(1.2+uWindAmt)+iB.y*6.28+iA.x*0.07;
  float sway=sin(ph)*(0.015+0.07*uWindAmt)*h*h*iA.w*3.0;
  float flut=aMat.x>=0.0 ? sin(uTime*(3.0+4.0*uWindAmt)+aPos.x*5.0+aPos.z*4.0+iB.y*20.0)*0.03*aMat.x*(0.3+uWindAmt*1.5)*iA.w : 0.0;
  vWp=iA.xyz+p+vec3(sway,flut,sway*0.6);
  vN=n; vCol=aCol*(0.82+0.36*iB.y); vUV=aMat; vObj=aPos; vSeed=iB.y;
  gl_Position=uVP*vec4(vWp,1.0);
}`;

SH.treeFS = SH.common + SH.fragLib + `
in vec3 vWp; in vec3 vN; in vec3 vCol; in vec2 vUV; in vec3 vObj; in float vSeed;
uniform float uA2C;
out vec4 oc;
void main(){
  vec3 N0=normalize(vN);
  vec3 alb; float alpha=1.0; vec3 N=N0; float spec=0.0;
  float dist=length(uCam-vWp);
  if(vUV.x<-0.5){                                   /* tronco */
    float ang=atan(vObj.z,vObj.x);
    float fw=fwidth(vObj.y)+fwidth(ang)*0.3+1e-4;
    float b1=fbmF(vec2(ang*2.2,vObj.y*3.5),4,fw*3.0);
    float b2=gn(vec2(ang*7.0,vObj.y*18.0));
    alb=vCol*(0.45+1.1*b1)*(0.85+0.3*b2);
    N=bump(N0,vWp,(b1*0.7+b2*0.2)*0.05,1.0);
    spec=0.04;
  } else {                                          /* fronda con aghi */
    float x=vUV.x, y=vUV.y;
    float hw=(0.3+0.7*sin(3.14159*(0.08+0.84*x)))*(1.0-pow(x,4.0)*0.85);
    float edge=abs(y)/max(hw,0.05);
    float ph=abs(y)*17.0-x*30.0;
    float fwp=fwidth(ph);
    float line=1.0-smoothstep(0.08,0.46,abs(fract(ph)-0.5));
    float rnd=hash12(vec2(floor(ph),floor(x*24.0)+vSeed*7.0));
    line*=step(0.14,rnd);
    line=mix(line,0.62,smoothstep(0.25,0.8,fwp));
    float cov=line*(1.0-smoothstep(0.7,1.0,edge));
    float stem=1.0-smoothstep(0.02,0.06,abs(y));
    alpha=max(cov,stem*0.9)*(1.0-smoothstep(0.9,1.0,x));
    float tip=smoothstep(0.55,1.0,x);
    alb=vCol*(0.75+0.7*rnd);
    alb=mix(alb,vec3(0.11,0.19,0.05),tip*0.5*rnd);
    alb=mix(alb,vec3(0.13,0.085,0.05),stem*0.8);
    float snowM=uSnow*smoothstep(0.35,0.8,N0.y)*(0.45+0.55*gn(vWp.xz*4.0+vWp.y));
    alb=mix(alb,vec3(0.86,0.89,0.94),snowM);
    alpha=max(alpha,snowM*0.85*(1.0-smoothstep(0.88,1.0,edge)));
    spec=0.0;
  }
  if(uA2C>0.5){ if(alpha<0.03) discard; }
  else { if(alpha<0.45) discard; alpha=1.0; }
  vec2 s=shadowAt(vWp);
  float sh=min(s.r,csm(vWp,N0));
  float ao=s.g;
  vec3 col=lightingS(alb,N,vWp,ao,sh,spec,30.0);
  /* trasparenza del fogliame: luce che attraversa gli aghi */
  float back=max(dot(-N0,uL),0.0);
  col+=alb*uLCol*sh*back*0.35*vec3(1.0,1.1,0.55)*step(-0.5,vUV.x);
  col=applyFog(col,vWp);
  oc=outc(col,alpha);
}`;

/* ---------- Rocce (istanziate), displacement e normali lisce nel vertex shader ---------- */
SH.rockDisp = `
float rhv(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float rnv(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(rhv(i),rhv(i+vec2(1.0,0.0)),f.x),mix(rhv(i+vec2(0.0,1.0)),rhv(i+vec2(1.0,1.0)),f.x),f.y); }
vec3 rockP(vec3 u,float sd){
  float n1=rnv(u.xz*2.1+u.y*1.7+sd)+0.5*rnv(u.xy*4.7+sd*1.7+u.z*3.0);
  float n2=rnv(u.xz*7.3+u.y*5.1+sd*3.0)*0.18;
  float facet=1.0-abs(2.0*rnv(u.xy*2.8+u.z*2.2+sd*2.3)-1.0);
  float r=0.68+n1*0.5+n2+facet*0.16;
  vec3 p=u*r; p.y*=0.72;
  return p;
}
`;
SH.rockVS = SH.common + SH.rockDisp + `
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iA;
layout(location=5) in vec2 iB;
out vec3 vWp; out vec3 vN; out float vSeed; out vec3 vLocal;
void main(){
  vec3 u=normalize(aPos);
  float sd=iB.y*37.0;
  vec3 t1=normalize(cross(u,abs(u.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0)));
  vec3 t2=cross(u,t1);
  float e=0.045;
  vec3 p0=rockP(u,sd), p1=rockP(normalize(u+t1*e),sd), p2=rockP(normalize(u+t2*e),sd);
  vec3 nl=normalize(cross(p1-p0,p2-p0)); if(dot(nl,u)<0.0) nl=-nl;
  float c=cos(iB.x), s=sin(iB.x);
  vec3 p=p0*iA.w;
  vLocal=p0;
  p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  vN=vec3(c*nl.x+s*nl.z,nl.y,-s*nl.x+c*nl.z);
  vWp=iA.xyz+p+vec3(0.0,iA.w*0.12,0.0);
  vSeed=iB.y;
  gl_Position=uVP*vec4(vWp,1.0);
}`;
SH.rockFS = SH.common + SH.fragLib + `
in vec3 vWp; in vec3 vN; in float vSeed; in vec3 vLocal;
out vec4 oc;
void main(){
  vec3 N0=normalize(vN);
  vec2 f2=fwidth(vWp.xz+vWp.y); float fw=max(f2.x,f2.y)+1e-4;
  float strata=fbmF(vec2(vWp.y*2.6,(vWp.x+vWp.z)*0.18),3,fw*2.6);
  float g=fbmF(vWp.xz*4.0+vWp.y*3.0,4,fw*4.0);
  float g2=fbmF(vWp.xz*16.0+vWp.y*11.0,3,fw*16.0);
  float crack=smoothstep(0.82,0.96,ridgedF(vec2(vWp.x+vWp.z,vWp.y)*2.4+vSeed*9.0));
  vec3 alb=mix(vec3(0.09,0.085,0.08),vec3(0.24,0.225,0.205),strata*0.7+g*0.45);
  alb*=0.8+0.4*vSeed; alb*=0.78+0.4*g2; alb*=1.0-0.55*crack;
  float moss=smoothstep(0.55,0.9,N0.y)*(1.0-smoothstep(60.0,130.0,vWp.y))*0.6;
  alb=mix(alb,vec3(0.07,0.115,0.035)*(0.7+0.6*g2),moss*(0.4+g));
  float lich=smoothstep(0.72,0.88,gn(vWp.xz*7.0+vWp.y*5.0))*0.4;
  alb=mix(alb,vec3(0.3,0.32,0.13),lich*(1.0-moss));
  float sn=uSnow*smoothstep(0.35,0.8,N0.y);
  alb=mix(alb,vec3(0.84,0.87,0.93),sn);
  float h=g*0.05+g2*0.015-crack*0.03;
  vec3 N=bump(N0,vWp,h,1.0);
  vec2 s=shadowAt(vWp);
  float sh=min(s.r,csm(vWp,N0));
  vec3 col=lightingS(alb,N,vWp,s.g,sh,0.08+sn*0.4,40.0);
  col=applyFog(col,vWp);
  oc=outc(col,1.0);
}`;

/* ---------- Erba: lame istanziate attorno al giocatore ---------- */
SH.grassVS = SH.common + `
layout(location=0) in vec2 aB;
uniform sampler2D uHeight;
uniform float uGrassSide;
uniform float uGrassR;
out vec3 vWp; out vec3 vCol; out float vT; out vec3 vN;
float gh(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float gv(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gh(i),gh(i+vec2(1.0,0.0)),f.x),mix(gh(i+vec2(0.0,1.0)),gh(i+vec2(1.0,1.0)),f.x),f.y); }
float hAt(vec2 xz){ return texture(uHeight,(xz+uWorldHalf)/(2.0*uWorldHalf)).r; }
void main(){
  float id=float(gl_InstanceID);
  float cx=mod(id,uGrassSide), cz=floor(id/uGrassSide);
  float sp=2.0*uGrassR/uGrassSide;
  vec2 base=floor(uCam.xz/sp)*sp-vec2(uGrassR)+vec2(cx,cz)*sp;
  vec2 cell=floor(base/sp+0.5);
  vec2 r=vec2(gh(cell),gh(cell+vec2(7.3,1.9)));
  vec2 xz=base+(r-0.5)*sp*1.6;
  float dist=length(xz-uCam.xz);
  float keep=1.0-smoothstep(uGrassR*0.55,uGrassR,dist);
  float rr=gh(cell+vec2(3.1,5.7));
  float y=hAt(xz);
  float yx=hAt(xz+vec2(1.5,0.0)), yz=hAt(xz+vec2(0.0,1.5));
  float slope=length(vec2(yx-y,yz-y))/1.5;
  float hm=gv(xz*0.05+vec2(40.0,11.0)), hm0=gv(xz*0.0042*3.0);
  float gM=(1.0-smoothstep(0.26,0.42,slope))*(1.0-smoothstep(100.0,155.0,y+(hm0-0.5)*70.0));
  gM*=smoothstep(0.7,1.8,y);
  float snowLine=mix(330.0,12.0,uSnow);
  gM*=1.0-smoothstep(snowLine-35.0,snowLine-5.0,y+hm0*40.0)*0.9;
  vec2 hd=abs(xz-uHut.xy);
  gM*=smoothstep(0.0,1.4,max(hd.x-uHut.z,hd.y-uHut.w));
  float clump=0.35+0.9*gv(xz*0.6);
  float height=(0.16+0.34*rr)*clump*(0.6+0.8*hm)*keep*gM;
  float wid=0.018+0.012*rr;
  float ang=rr*6.2831+id*1.7;
  vec2 dir=vec2(cos(ang),sin(ang));
  float t=aB.y;
  float wind=(sin(uTime*(1.6+uWindAmt*2.0)+xz.x*0.9+xz.y*0.7)*0.5+sin(uTime*2.7+xz.x*2.3)*0.25)*(0.04+0.22*uWindAmt)*t*t;
  float lean=(rr-0.5)*0.45*t*t;
  vec3 wp=vec3(xz.x,y,xz.y);
  wp.xz+=dir*aB.x*wid*(1.0-t*0.8);
  wp.xz+=vec2(wind+lean,wind*0.6-lean)*height*3.0;
  wp.y+=t*height*(1.0-0.12*t);
  vec3 g1=vec3(0.028,0.048,0.012), g2=vec3(0.13,0.17,0.05), dry=vec3(0.2,0.17,0.08);
  vec3 tipc=mix(g2,dry,smoothstep(0.55,0.85,hm0+(rr-0.5)*0.3));
  vCol=mix(g1,tipc,t)*(0.7+0.6*gh(cell+vec2(9.0,2.0)));
  vCol=mix(vCol,vec3(0.5,0.55,0.6)*0.0+vCol,0.0);
  vT=t; vWp=wp;
  vN=normalize(vec3(dir.y*aB.x*0.4,0.8,-dir.x*aB.x*0.4)+vec3(0.0,0.2,0.0));
  gl_Position=(height>0.012)?uVP*vec4(wp,1.0):vec4(2.0,2.0,2.0,1.0);
}`;
SH.grassFS = SH.common + SH.fragLib + `
in vec3 vWp; in vec3 vCol; in float vT; in vec3 vN;
out vec4 oc;
void main(){
  vec3 N=normalize(vN);
  float snowM=uSnow*smoothstep(0.3,1.0,vT)*0.75;
  vec3 alb=mix(vCol,vec3(0.85,0.88,0.93),snowM);
  vec2 s=shadowAt(vWp);
  float sh=min(s.r,csm(vWp,vec3(0.0,1.0,0.0)));
  float ao=s.g*(0.38+0.62*vT);
  vec3 col=lighting(alb,N,vWp,ao,sh);
  col+=alb*uLCol*sh*0.28*vT*vec3(1.0,1.1,0.5);
  col=applyFog(col,vWp);
  oc=outc(col,1.0);
}`;

/* ---------- Acqua ---------- */
SH.waterVS = SH.common + `
layout(location=0) in vec2 aXZ;
uniform float uWaterY;
out vec3 vWp;
void main(){ vWp=vec3(aXZ.x,uWaterY,aXZ.y); gl_Position=uVP*vec4(vWp,1.0); }`;
SH.waterFS = SH.common + SH.fragLib + SH.skyLib + `
in vec3 vWp;
uniform sampler2D uHeight;
out vec4 oc;
float wave(vec2 p,float t){
  return vn(p*0.35+vec2(t*0.08,t*0.05))+vn(p*1.1-vec2(t*0.15,-t*0.1))*0.5+vn(p*3.7+vec2(t*0.3,t*0.2))*0.25;
}
void main(){
  vec2 uv=(vWp.xz+uWorldHalf)/(2.0*uWorldHalf);
  float th=texture(uHeight,uv).r;
  float depth=max(vWp.y-th,0.0);
  if(depth<0.02){ discard; }
  float t=uTime;
  float e=0.12, amp=0.05+0.35*uWindAmt;
  float h0=wave(vWp.xz,t), hx=wave(vWp.xz+vec2(e,0.0),t), hz=wave(vWp.xz+vec2(0.0,e),t);
  vec3 N=normalize(vec3((h0-hx)/e*amp,1.0,(h0-hz)/e*amp));
  vec3 V=normalize(uCam-vWp);
  float fres=0.03+0.97*pow(1.0-max(dot(N,V),0.0),5.0);
  vec3 R=reflect(-V,N); R.y=abs(R.y);
  vec3 refl=skyBasic(R);
  vec3 lv=uAmbT*0.9+uLCol*0.1;
  vec3 body=mix(vec3(0.05,0.17,0.16),vec3(0.012,0.06,0.08),smoothstep(0.0,5.0,depth))*lv*1.6;
  vec3 col=mix(body,refl,fres);
  vec3 H=normalize(uL+V);
  col+=uLCol*pow(max(dot(N,H),0.0),160.0)*1.2;
  for(int i=0;i<4;i++){
    float inten=uFire[i].w;
    if(inten>0.001){ vec3 d=uFire[i].xyz-vWp; float dist=length(d); col+=vec3(1.0,0.5,0.2)*inten/(1.0+dist*dist*0.12)*fres*1.5; }
  }
  float foam=smoothstep(0.45,0.0,depth)*(0.45+0.55*vn(vWp.xz*4.0+t*0.4));
  col=mix(col,(uAmbT+uLCol*0.25)*0.9,foam*0.55);
  col=applyFog(col,vWp);
  float alpha=clamp(smoothstep(0.02,0.5,depth)*0.97,0.0,1.0);
  oc=outc(col,alpha);
}`;

/* ---------- Neve in caduta ---------- */
SH.snowVS = SH.common + `
layout(location=0) in vec3 aSeed;
uniform float uRate;
uniform float uPix;
uniform vec2 uWind;
out float vA;
void main(){
  vec3 box=vec3(46.0,24.0,46.0);
  vec3 p=aSeed*box;
  float fall=2.2+aSeed.x*1.6+uWindAmt*1.2;
  p.y-=uTime*fall;
  p.xz+=uWind*uTime*(1.0+aSeed.y*0.4);
  p.x+=sin(uTime*0.8+aSeed.z*30.0)*0.6; p.z+=cos(uTime*0.7+aSeed.x*30.0)*0.6;
  vec3 rel=mod(p-uCam,box)-box*0.5;
  vec3 wp=uCam+rel;
  gl_Position=uVP*vec4(wp,1.0);
  float d=length(rel);
  vA=(1.0-smoothstep(14.0,23.0,d))*step(aSeed.y,uRate);
  gl_PointSize=clamp(14.0/max(gl_Position.w,0.5),1.0,6.0)*uPix*(0.6+0.8*aSeed.z);
  if(vA<=0.001) gl_Position=vec4(2.0,2.0,2.0,1.0);
}`;
SH.snowFS = SH.common + SH.fragLib + `
in float vA;
out vec4 oc;
void main(){
  float d=length(gl_PointCoord-0.5)*2.0;
  float a=smoothstep(1.0,0.2,d)*vA*0.85;
  vec3 col=(uAmbT*1.1+uLCol*0.15)*vec3(0.9,0.95,1.0)*3.0+vec3(0.12);
  oc=outc(col,a);
}`;

/* ---------- Fiamme, braci e fumo ---------- */
SH.fireVS = SH.common + `
layout(location=0) in vec3 aS;
uniform vec4 uFP;
uniform float uPix;
out vec3 vC; out float vA; out float vSeed; out float vLife;
void main(){
  float life=fract(aS.x+uTime*(0.75+aS.y*0.5));
  vec3 wp=uFP.xyz+vec3((aS.y-0.5)*0.42*(1.0-life)+sin(uTime*7.0+aS.z*20.0)*0.05*life,
                       0.1+life*life*1.35,
                       (aS.z-0.5)*0.42*(1.0-life));
  gl_Position=uVP*vec4(wp,1.0);
  gl_PointSize=min((1.0-life*0.7)*(80.0*uFP.w+14.0)/max(gl_Position.w,0.5),90.0)*uPix;
  vC=mix(vec3(3.2,2.0,0.7),vec3(1.5,0.22,0.03),life);
  vA=(1.0-life)*clamp(uFP.w,0.0,1.0)*smoothstep(0.5,2.2,gl_Position.w);
  vSeed=aS.y*17.0+aS.z; vLife=life;
}`;
SH.fireFS = SH.common + SH.fragLib + `
in vec3 vC; in float vA; in float vSeed; in float vLife;
out vec4 oc;
void main(){
  vec2 pc=gl_PointCoord*2.0-1.0;
  pc.y*=0.85;
  float n=gn(pc*2.6+vec2(vSeed,-uTime*3.2+vSeed));
  float d=length(pc*vec2(1.0,0.75))+(n-0.5)*0.6;
  float a=smoothstep(1.0,0.0,d);
  a*=a;
  oc=vec4(vC*a*vA*0.8,0.0);
}`;
SH.emberVS = SH.common + `
layout(location=0) in vec3 aS;
uniform vec4 uFP;
uniform float uPix;
out float vA;
void main(){
  float life=fract(aS.x*3.0+uTime*(0.25+aS.y*0.2));
  vec3 wp=uFP.xyz+vec3((aS.y-0.5)*0.6+sin(uTime*2.0+aS.z*30.0)*0.3*life+uWindAmt*life*1.5,
                       0.2+life*2.6,
                       (aS.z-0.5)*0.6+cos(uTime*1.7+aS.y*30.0)*0.3*life);
  gl_Position=uVP*vec4(wp,1.0);
  gl_PointSize=clamp(5.0/max(gl_Position.w,0.5),1.0,3.0)*uPix;
  vA=(1.0-life)*clamp(uFP.w,0.0,1.0)*step(0.5,aS.z);
}`;
SH.emberFS = SH.common + `
in float vA;
out vec4 oc;
void main(){
  float d=length(gl_PointCoord-0.5)*2.0;
  oc=vec4(vec3(3.0,1.1,0.25)*smoothstep(1.0,0.0,d)*vA,0.0);
}`;
SH.smokeVS = SH.common + `
layout(location=0) in vec3 aS;
uniform vec4 uFP;
uniform float uPix;
out float vA; out float vSeed;
void main(){
  float life=fract(aS.x+uTime*(0.07+aS.y*0.04));
  vec3 wp=uFP.xyz+vec3(life*(1.5+uWindAmt*9.0)+(aS.y-0.5)*life*1.4, life*7.0, (aS.z-0.5)*life*1.4);
  gl_Position=uVP*vec4(wp,1.0);
  gl_PointSize=min((16.0+life*130.0)/max(gl_Position.w,0.5),150.0)*uPix;
  vA=smoothstep(0.0,0.08,life)*(1.0-life)*uFP.w*0.5;
  vSeed=aS.z*31.0;
}`;
SH.smokeFS = SH.common + SH.fragLib + `
in float vA; in float vSeed;
out vec4 oc;
void main(){
  vec2 pc=gl_PointCoord*2.0-1.0;
  float n=gn(pc*2.2+vSeed+uTime*0.15);
  float d=length(pc)+(n-0.5)*0.55;
  float a=smoothstep(1.0,0.2,d)*vA;
  vec3 col=(uAmbT*1.3+uLCol*0.22)*0.65;
  oc=outc(col,a);
}`;

/* ---------- Passaggi per le ombre (solo profondita') ---------- */
SH.shPropVS = `
layout(location=0) in vec3 aPos;
uniform mat4 uSMVP;
void main(){ gl_Position=uSMVP*vec4(aPos,1.0); }`;
SH.shTreeVS = `
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iA;
layout(location=5) in vec2 iB;
uniform mat4 uSMVP;
void main(){
  float c=cos(iB.x), s=sin(iB.x);
  vec3 p=aPos*iA.w; p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  gl_Position=uSMVP*vec4(iA.xyz+p,1.0);
}`;
SH.shRockVS = SH.rockDisp + `
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iA;
layout(location=5) in vec2 iB;
uniform mat4 uSMVP;
void main(){
  vec3 u=normalize(aPos);
  vec3 p=rockP(u,iB.y*37.0)*iA.w;
  float c=cos(iB.x), s=sin(iB.x);
  p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  gl_Position=uSMVP*vec4(iA.xyz+p+vec3(0.0,iA.w*0.12,0.0),1.0);
}`;
SH.shFS = `void main(){}`;

/* ---------- Post-processing: bloom + composizione finale ---------- */
SH.postVS = `
out vec2 vUV;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUV=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
SH.bloomDownFS = `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uFirst;
out vec4 oc;
vec3 S(vec2 o){ return texture(uTex,vUV+o*uTexel).rgb; }
float kw(vec3 c){ return 1.0/(1.0+dot(c,vec3(0.2126,0.7152,0.0722))); }
void main(){
  vec3 a=S(vec2(-2,-2)),b=S(vec2(0,-2)),c=S(vec2(2,-2)),d=S(vec2(-1,-1)),e=S(vec2(1,-1)),
       f=S(vec2(-2,0)),g=S(vec2(0,0)),h=S(vec2(2,0)),i=S(vec2(-1,1)),j=S(vec2(1,1)),
       k=S(vec2(-2,2)),l=S(vec2(0,2)),m=S(vec2(2,2));
  vec3 col;
  if(uFirst>0.5){
    vec3 g0=(d+e+i+j)*0.25, g1=(a+b+f+g)*0.25, g2=(b+c+g+h)*0.25, g3=(f+g+k+l)*0.25, g4=(g+h+l+m)*0.25;
    col=g0*0.5*kw(g0)+g1*0.125*kw(g1)+g2*0.125*kw(g2)+g3*0.125*kw(g3)+g4*0.125*kw(g4);
    col/=(0.5*kw(g0)+0.125*(kw(g1)+kw(g2)+kw(g3)+kw(g4)));
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    col*=smoothstep(0.9,2.6,lum);
  } else {
    col=(d+e+i+j)*0.125+(a+b+f+g)*0.03125+(b+c+g+h)*0.03125+(f+g+k+l)*0.03125+(g+h+l+m)*0.03125;
  }
  oc=vec4(col,1.0);
}`;
SH.bloomUpFS = `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 oc;
void main(){
  vec3 c=texture(uTex,vUV).rgb*4.0;
  c+=texture(uTex,vUV+vec2(-1,0)*uTexel).rgb*2.0+texture(uTex,vUV+vec2(1,0)*uTexel).rgb*2.0;
  c+=texture(uTex,vUV+vec2(0,-1)*uTexel).rgb*2.0+texture(uTex,vUV+vec2(0,1)*uTexel).rgb*2.0;
  c+=texture(uTex,vUV+vec2(-1,-1)*uTexel).rgb+texture(uTex,vUV+vec2(1,-1)*uTexel).rgb;
  c+=texture(uTex,vUV+vec2(-1,1)*uTexel).rgb+texture(uTex,vUV+vec2(1,1)*uTexel).rgb;
  oc=vec4(c/16.0,1.0);
}`;
SH.compFS = `
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uPx;
uniform float uBloomK;
uniform float uExp;
uniform float uTime;
uniform float uCold;
uniform float uSharp;
out vec4 oc;
vec3 aces(vec3 c){ c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14); return clamp(c,0.0,1.0); }
void main(){
  vec3 c=texture(uScene,vUV).rgb;
  vec3 n=texture(uScene,vUV+vec2(0.0,-uPx.y)).rgb, s=texture(uScene,vUV+vec2(0.0,uPx.y)).rgb;
  vec3 e=texture(uScene,vUV+vec2(uPx.x,0.0)).rgb, w=texture(uScene,vUV+vec2(-uPx.x,0.0)).rgb;
  vec3 mn=min(min(n,s),min(e,w)), mx=max(max(n,s),max(e,w));
  vec3 blur=(n+s+e+w)*0.25;
  vec3 sh=c+(c-blur)*uSharp;
  c=clamp(sh,min(mn,c),max(mx,c));
#ifdef HDR
  c+=texture(uBloom,vUV).rgb*uBloomK;
  c*=uExp;
  vec2 q=vUV-0.5;
  float vig=1.0-dot(q,q)*0.9;
  c*=mix(1.0,vig,0.7);
  c=aces(c);
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  c=mix(vec3(l),c,1.06);
  c=c*c*(3.0-2.0*c)*0.35+c*0.65;
  c=mix(c,vec3(dot(c,vec3(0.33)))*vec3(0.85,0.95,1.1),uCold*0.55);
  c=pow(c,vec3(1.0/2.2));
#endif
  float g=fract(sin(dot(vUV*vec2(1731.0,977.0)+uTime,vec2(12.9898,78.233)))*43758.5453);
  c+=(g-0.5)*0.016;
  oc=vec4(c,1.0);
}`;
