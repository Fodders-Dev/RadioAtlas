// A completed turn cannot end by promising a lookup that no worker will run.
// This is a narrow deferred-work guard, not general factual verification.
export const promisesUnperformedLookup = (reply: string): boolean => {
  // Quoted promises are data (e.g. an explanation of the previous failure).
  const ownText = reply.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '');
  return /(?:^|[.!?]\s+)(?:я\s+)?(?:сейчас(?:\s+быстро)?|погоди|секунду)[\s,—:-]+(?:я\s+)?(?:гляну|посмотрю|поищу|найду|подберу|проверю)(?![а-яё])/i.test(ownText) ||
    /(?:^|[.!?]\s+)(?:давай|дай мне)\s+(?:я\s+)?(?:поищу|подберу|посмотрю)(?![а-яё])/i.test(ownText);
};

// Catalogue tags describe a format; they never establish what a live programme
// will contain. Recognise the common absolute absence claims from live audits.
export const assertsUnverifiedProgram = (reply: string): boolean => {
  const ownText = reply.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '');
  return ownText.split(/[.!?]/).some(sentence => {
    if (/(?:не\s+(?:могу\s+)?(?:гарантир|обещ)|нельзя\s+гарантир|не\s+гарантия)/i.test(sentence)) return false;
    return /(?:без\s+|никак(?:ой|их|ого)\s+|(?:нет|не будет|не бывает)\s+)(?:реклам|ведущ|вокал|новост)[а-яё]*/i.test(sentence);
  });
};
