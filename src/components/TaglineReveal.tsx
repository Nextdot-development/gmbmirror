"use client";
import { useEffect, useRef } from "react";

export function TaglineReveal({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");

  useEffect(() => {
    const spans = Array.from(ref.current?.querySelectorAll<HTMLElement>(".tag-word") ?? []);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spans.forEach((s) => s.classList.add("is-on"));
      return;
    }
    // One observer per word. A word turns on when it crosses 70 percent of the viewport height.
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          e.target.classList.toggle("is-on", e.isIntersecting || e.boundingClientRect.top < 0);
        });
      },
      { rootMargin: "0px 0px -30% 0px", threshold: 0 },
    );
    spans.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <p ref={ref} className="heading-2 max-w-[680px]" aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="tag-word" aria-hidden>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
