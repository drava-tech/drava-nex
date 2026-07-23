"use client";

import React, { useState } from "react";

const cards = [
  {
    id: "trusted-friends",
    title: "Trusted Friends",
    description:
      "Trusted Friend is a M-of-N social recovery module that allows users to access their accounts even if they lose their private keys.",
    buttonLabel: "Add Guardian",
    buttonColor: "#e040fb",
    glowColor: "rgba(224,64,251,0.35)",
    illustration: (
      <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden>
        <defs>
          <radialGradient id="glow1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e040fb" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hand1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f48fb1" />
            <stop offset="100%" stopColor="#e040fb" />
          </linearGradient>
          <linearGradient id="hand2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#26c6da" />
            <stop offset="100%" stopColor="#40c4ff" />
          </linearGradient>
        </defs>
        <ellipse cx="80" cy="80" rx="68" ry="68" fill="url(#glow1)" />
        <path d="M40 65 Q55 50 80 58 Q100 64 118 60" stroke="url(#hand1)" strokeWidth="12" strokeLinecap="round" fill="none" />
        <path d="M40 65 Q45 75 55 72" stroke="url(#hand1)" strokeWidth="10" strokeLinecap="round" fill="none" />
        <path d="M42 95 Q60 108 85 100 Q105 94 120 98" stroke="url(#hand2)" strokeWidth="12" strokeLinecap="round" fill="none" />
        <path d="M42 95 Q47 85 56 88" stroke="url(#hand2)" strokeWidth="10" strokeLinecap="round" fill="none" />
        {[[72,75],[80,68],[88,78],[76,84],[84,70],[90,82]].map(([cx,cy],i) => (
          <circle key={i} cx={cx} cy={cy} r="2.5" fill={i%2===0?"#e040fb":"#40c4ff"} opacity="0.9" />
        ))}
      </svg>
    ),
  },
  {
    id: "identity",
    title: "Identity",
    description:
      "All accounts can have an unlimited number of sub-accounts specified, enabling flexible multi-identity management.",
    buttonLabel: "Verify Identity",
    buttonColor: "#ec407a",
    glowColor: "rgba(236,64,122,0.38)",
    illustration: (
      <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden>
        <defs>
          <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ec407a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fp" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e040fb" />
            <stop offset="100%" stopColor="#ec407a" />
          </linearGradient>
        </defs>
        <ellipse cx="80" cy="80" rx="68" ry="68" fill="url(#glow2)" />
        {[28,22,16,10,4].map((r,i) => (
          <path key={i} d={`M ${80-(30+r*2)} 80 A ${30+r*2} ${30+r*2} 0 0 1 ${80+(30+r*2)} 80`} stroke="url(#fp)" strokeWidth="3" strokeLinecap="round" fill="none" opacity={0.9-i*0.1} />
        ))}
        {[28,22,16,10].map((r,i) => (
          <path key={i+10} d={`M ${80-(20+r*2)} 90 A ${20+r*2} ${20+r*2} 0 0 1 ${80+(20+r*2)} 90`} stroke="url(#fp)" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity={0.75-i*0.08} />
        ))}
        <circle cx="80" cy="80" r="6" fill="#ec407a" opacity="0.9" />
        <circle cx="80" cy="80" r="3" fill="#f48fb1" />
      </svg>
    ),
  },
  {
    id: "capsule-shard",
    title: "Backup of the capsule shard",
    description:
      "Each capsule has a unique shard which allows the NFT owner to decipher it, ensuring secure decentralized key recovery.",
    buttonLabel: "Create Backup",
    buttonColor: "#26c6da",
    glowColor: "rgba(38,198,218,0.32)",
    illustration: (
      <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden>
        <defs>
          <radialGradient id="glow3" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#26c6da" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orb1" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#f06292" />
            <stop offset="100%" stopColor="#880e4f" />
          </radialGradient>
          <radialGradient id="orb2" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#4dd0e1" />
            <stop offset="100%" stopColor="#006064" />
          </radialGradient>
        </defs>
        <ellipse cx="80" cy="80" rx="68" ry="68" fill="url(#glow3)" />
        <ellipse cx="80" cy="52" rx="22" ry="22" fill="url(#orb1)" />
        <ellipse cx="80" cy="92" rx="34" ry="10" stroke="#26c6da" strokeWidth="3" fill="none" opacity="0.7" />
        <ellipse cx="80" cy="92" rx="24" ry="24" fill="url(#orb2)" opacity="0.85" />
        <ellipse cx="80" cy="92" rx="34" ry="10" stroke="#80deea" strokeWidth="1.5" fill="none" opacity="0.4" />
      </svg>
    ),
  },
];

export default function FeatureCards() {
  const [clicked, setClicked] = useState<string | null>(null);

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a0e1a 0%,#0d1224 60%,#0f1628 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:"48px 24px", fontFamily:"'Inter','Segoe UI',sans-serif" }}>
      <div style={{ display:"flex", gap:"20px", flexWrap:"wrap", justifyContent:"center", maxWidth:860 }}>
        {cards.map((card) => (
          <div
            key={card.id}
            style={{ width:240, borderRadius:20, background:"linear-gradient(180deg,#151c2e 0%,#111827 100%)", boxShadow:`0 0 0 1px rgba(255,255,255,0.06),0 8px 40px rgba(0,0,0,0.5),0 0 60px ${card.glowColor}`, overflow:"hidden", display:"flex", flexDirection:"column", transition:"transform 0.25s ease,box-shadow 0.25s ease" }}
            onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform="translateY(-6px)";(e.currentTarget as HTMLDivElement).style.boxShadow=`0 0 0 1px rgba(255,255,255,0.1),0 16px 60px rgba(0,0,0,0.6),0 0 80px ${card.glowColor}`;}}
            onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform="translateY(0)";(e.currentTarget as HTMLDivElement).style.boxShadow=`0 0 0 1px rgba(255,255,255,0.06),0 8px 40px rgba(0,0,0,0.5),0 0 60px ${card.glowColor}`;}}
          >
            {/* Illustration */}
            <div style={{ background:"radial-gradient(ellipse at 50% 60%,#1a2340 0%,#0d1224 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 0 32px", position:"relative" }}>
              <div style={{ position:"absolute", width:160, height:160, borderRadius:"50%", background:`radial-gradient(circle,${card.glowColor} 0%,transparent 70%)` }} />
              <div style={{ position:"relative", zIndex:1 }}>{card.illustration}</div>
            </div>
            {/* Content */}
            <div style={{ padding:"24px 20px 28px", flex:1, display:"flex", flexDirection:"column", gap:10 }}>
              <h3 style={{ margin:0, color:"#ffffff", fontSize:18, fontWeight:700, lineHeight:1.3, letterSpacing:"-0.02em" }}>{card.title}</h3>
              <p style={{ margin:0, color:"rgba(255,255,255,0.5)", fontSize:13, lineHeight:1.6, flex:1 }}>{card.description}</p>
              <button
                onClick={()=>setClicked(card.id)}
                style={{ marginTop:16, padding:"10px 0", width:"100%", borderRadius:10, border:`1.5px solid ${card.buttonColor}`, background:clicked===card.id?card.buttonColor:`linear-gradient(135deg,${card.buttonColor}22 0%,${card.buttonColor}11 100%)`, color:clicked===card.id?"#fff":card.buttonColor, fontSize:13, fontWeight:600, cursor:"pointer", letterSpacing:"0.03em", transition:"all 0.2s ease", boxShadow:clicked===card.id?`0 0 20px ${card.glowColor}`:"none" }}
                onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background=card.buttonColor;(e.currentTarget as HTMLButtonElement).style.color="#fff";(e.currentTarget as HTMLButtonElement).style.boxShadow=`0 0 24px ${card.glowColor}`;}}
                onMouseLeave={e=>{if(clicked!==card.id){(e.currentTarget as HTMLButtonElement).style.background=`linear-gradient(135deg,${card.buttonColor}22 0%,${card.buttonColor}11 100%)`;(e.currentTarget as HTMLButtonElement).style.color=card.buttonColor;(e.currentTarget as HTMLButtonElement).style.boxShadow="none";}}}
              >
                {clicked===card.id?"✓ Done":card.buttonLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
