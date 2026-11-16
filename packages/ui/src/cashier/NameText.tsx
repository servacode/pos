/**
 * A product's name as its own bidi isolate, with a closing «(3 أزواج)» kept whole: the line may wrap
 * before it, never inside it, so no «(3» is left at one line's end and «أزواج)» at the next one's start.
 */
export function NameText({ name }: { name: string }) {
  const parts = /^(.*\S)(\s+)(\([^()]*\))$/.exec(name);
  return (
    <bdi dir="auto">
      {parts ? (
        <>
          {parts[1]}
          {parts[2]}
          <span className="whitespace-nowrap">{parts[3]}</span>
        </>
      ) : (
        name
      )}
    </bdi>
  );
}
