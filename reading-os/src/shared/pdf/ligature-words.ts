// Common English words (general, scientific and clinical) spelled with the
// letter pairs that books print as ligatures: ff, fi, fl, ffi, ffl, ft.
// Used to recognise ligature glyphs that a PDF leaves unnamed, for words the
// book itself never spells out in plain letters. Stems are enough: a word
// counts when it starts with one of these ("reflect" covers "reflected").

export const LIGATURE_STEMS = `
affect affirm afford affix affinit afflict affluen afraid aft after afterward artifact artific beneficial benefit
bluff buffer buffet chiefl classif clarif coefficient coffee confid confirm conflict conflu configur cliff craft
crafted daffodil deficien deficit defin define definit deflat deflect diffract differ different differential
difficult diffus draft drift effect effectiv efficac efficien effort effus effluen elfin fifteen fifth fifty
figur filament file filling film filter filtrat final finan find fine finger finish finite fire firm first fish fission
fissur fistul fit five fix fixat flag flake flame flank flap flare flash flat flavo flaw fled flesh flex flexib
flexion flexor flicker flight flip float floor flora flow fluid fluke fluor fluores fluoride fluoro flush flutter
flux fly gift graft half identif infiltrat infinit inflam inflat inflect influen influx inform insuffic
insufficient justif left lift lifted magnif modif modifi notif nullif offend offer office officer
official offset often oft outflow overflow pacif profil profit proficien purif qualif quantif rafter raft
ratif reaffirm reflect reflex reflux refill refine refined refinement refract rift scaffold scoff scuff self shaft
shift shifted shuffle sniff snuff soft soften specific specifi staff stiff stiffen stiffness suffer suffic
sufficien suffix suffocat swift terrific theft thrift traffic uplift unaffected unclassified uniform unified unify
verif waffle whiff
`
  .trim()
  .split(/\s+/);

/** True when a lower-case word starts with one of the stems. */
export function isLigatureWord(word: string): boolean {
  const w = word.toLowerCase();
  for (const s of LIGATURE_STEMS) if (w.startsWith(s) && s.length >= 3) return true;
  return false;
}
