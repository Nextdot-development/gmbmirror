import { test } from "node:test";
import assert from "node:assert/strict";
import { medicalWarnings } from "@/lib/medical";

const flags = (t: string) => medicalWarnings(t).length > 0;
const discount = (t: string) => medicalWarnings(t).some((w) => w.startsWith("Discounts and offers"));

test("guarantee rule catches 100% claims (word boundary after %)", () => {
  for (const t of ["100% cure", "100% results", "it is 100%", "100% painless treatment", "results 100 % guaranteed"]) assert.ok(flags(t), t);
});

test("discount wording triggers", () => {
  for (const t of ["20% off", "Get a discount", "Flat ₹500 off", "flat Rs. 200 on scaling", "free checkup offer", "Special offer this week",
    "Offer valid till Friday", "Diwali offer chal raha hai", "ye offer sirf weekdays ke liye hai", "Free consultation", "दिवाली ऑफर"]) assert.ok(discount(t), t);
});

test("'offer' used as a verb does not trigger the discount warning", () => {
  for (const t of ["The clinic offers acne consultations", "We offer consultations on Sunday", "Our clinic is offering skin checks",
    "Hum skin consultation offer karte hain", "Add every service the clinic offers to your profile"]) assert.ok(!discount(t), t);
});

test("Hindi (Devanagari) and Hinglish risky phrases are caught, with or without the nukta", () => {
  for (const t of ["100% ilaj", "100% इलाज", "pakka ilaj milega", "पक्का इलाज", "गारंटी के साथ", "jad se khatam", "जड़ से खत्म",
    "hamesha ke liye theek", "हमेशा के लिए ठीक", "sabse accha doctor", "सबसे अच्छा डॉक्टर", "50% छूट", "muft jaanch", "मुफ़्त जांच", "मुफ्त जांच",
    "bina dard ke", "बिना दर्द", "koi side effect nahi", "चमत्कारी"]) assert.ok(flags(t), t);
});

test("ordinary sentences are not flagged", () => {
  for (const t of ["Dr. Sharma ka clinic Sunday ko khula hai", "हम रविवार को खुले हैं", "aapka dhanyavaad", "Matlab ye theek hai", "pakki baat",
    "Thank you for visiting us, Rohit.", "We are open 9 to 5 on Sunday."]) assert.deepEqual(medicalWarnings(t), [], t);
});
