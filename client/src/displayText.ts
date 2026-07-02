const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

function hasCjk(value: string | undefined): boolean {
  return !!value && CJK.test(value);
}

export function displayText(value: string): string {
  return value
    .replace(/\[\[task:[^\]]*\]\]/g, '')
    .replace(/—+/g, ',')
    .replace(/,/g, (comma, index, source) => {
      const prev = source[index - 1];
      const next = source[index + 1];
      return hasCjk(prev) || hasCjk(next) ? '，' : comma;
    });
}
