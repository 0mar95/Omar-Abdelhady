// Section names that carry classification codes ("Migraine (ICHD 1.x.x;
// ICD-10 G43.xxx)") read as the name, with the codes set small and quiet.

const CODE = /\b(?:ICHD|ICD|ICOP|DSM|ICSD|ICF|AJCC|TNM|WHO|ORPHA|OMIM)\b|\b[A-Z]\d{2}(?:\.[\dx]+)?\b|\b\d+(?:\.[\dx]+){2,}\b/;

/** The name without its code brackets, and the codes ("ICHD 1.x.x · ICD-10 G43.xxx"). */
export function splitCodes(text: string): { name: string; codes: string } {
  const codes: string[] = [];
  const name = text
    .replace(/\s*\(([^()]{2,})\)/g, (all, inner: string) => {
      if (!CODE.test(inner)) return all;
      codes.push(inner.replace(/\s*;\s*/g, " · ").trim());
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return name.length >= 3 && codes.length ? { name, codes: codes.join(" · ") } : { name: text, codes: "" };
}

export function Title({ text }: { text: string }) {
  const { name, codes } = splitCodes(text);
  if (!codes) return <>{text}</>;
  return (
    <>
      {name}
      <span className="title-codes" title={codes}>
        {codes}
      </span>
    </>
  );
}
