/**
 * Plain language check for risky claims in healthcare posts and replies.
 * It is a prompt to reread, not legal advice. NMC rules and your own judgement decide.
 */
const RULES: { pattern: RegExp; message: string }[] = [
  { pattern: /(\b100\s*%|\bguarantee[sd]?\b|गारंटी|गारन्टी|\bpakk[ai]\s+(ilaa?j|guarantee)\b|पक्क[ाी]\s+(इलाज|गारंटी))/i, message: "Avoids guarantees. Results differ between patients." },
  { pattern: /(\b(best|no\.?\s*1|number one|top|leading|famous)\s+(doctor|clinic|hospital|dentist|surgeon)|\bsabse\s+(acc?h+a|badhiya|best)\s+(doctor|clinic|hospital|dentist|daktar)|सबसे\s+(अच्छा|अच्छे|बढिया|बेहतरीन)\s+(डॉक्टर|डाक्टर|क्लिनिक|अस्पताल)|नंबर\s*(1|१|वन)\s+(डॉक्टर|डाक्टर|क्लिनिक|अस्पताल))/i, message: "Superlatives like best or number one are not allowed in medical advertising." },
  { pattern: /(\b(cure[sd]?|permanent(ly)?\s+(cure|solution|relief))\b|\bilaa?j\s+pakk[ai]\b|\b(jad|jadd|jarh)\s+se\s+(khatam|ilaa?j|theek|thik|mukti)\b|जड\s+से|\bhamesha\s+ke\s+liye\s+(theek|thik|khatam)\b|हमेशा\s+के\s+लिए\s+(ठीक|खत्म)|\bpermanent\s+ilaa?j\b|(स्थायी|परमानेंट)\s+इलाज)/i, message: "Do not promise a cure or a permanent result." },
  { pattern: /\b(before\s*(and|&|\/)\s*after|before-after)\b/i, message: "Before and after claims need extra care. Check the rules that apply to you." },
  // "offer" counts only as a promotion ("special offer", "offer valid till", "Diwali offer chal raha hai"),
  // never as a verb ("the clinic offers", "we offer", "offering", "offer karte hain").
  { pattern: /(\bdiscounts?\b|%\s*off\b|\b(special|limited[- ]time|festive|festival|diwali|holi|introductory|launch|exclusive|combo|seasonal|weekend|weekday|monsoon|new year|free(?:\s+\w+)?)\s+offers?\b|\boffers?\s*(:|valid|ends|till|until|price|code|applicable|lagu|chal|mil|sirf|hai\b)|ऑफर|\bfree (consultation|check)|\bflat\s*(₹|rs\.?|inr)\s*\d|\bchh?oo?t\b|छूट|\bmu?fa?t\b|मुफ्त|मुफत|\bfree\s+(jaa?nch|checkup)\b|फ्री\s+(जांच|जाँच|चेकअप))/i, message: "Discounts and offers on medical services can breach advertising rules. Check before posting." },
  { pattern: /\b(testimonial|patient said|our patient)\b/i, message: "Do not publish patient testimonials or patient details in your own posts." },
  { pattern: /(\b(miracle|painless|risk[\s-]?free|no side effects?)\b|\bbina\s+dard\b|बिना\s+दर्द|दर्द\s*रहित|\bkoi\s+side\s*effect\s+nahi|कोई\s+साइड\s*इफेक्ट\s+नहीं|\bchamatkar|चमत्कार)/i, message: "Words like painless, risk free and no side effects overpromise." },
];

/**
 * English, Hindi (Devanagari) and Hinglish (Roman script) phrases are checked.
 * Hindi text is decomposed and the nukta dot removed, so "मुफ़्त" and "मुफ्त" match the same rule.
 */
export function medicalWarnings(text: string): string[] {
  const plain = text.normalize("NFD").replace(/\u093C/g, "");
  return RULES.filter((r) => r.pattern.test(plain)).map((r) => r.message);
}
