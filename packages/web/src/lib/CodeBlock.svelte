<script lang="ts">
  interface Props {
    code: string;
    lang?: 'ts' | 'svelte' | 'vue' | 'jsx' | 'bash';
  }

  let { code, lang = 'ts' }: Props = $props();

  // Lightweight syntax highlighter — covers keywords, strings, comments, tags, types
  function highlight(src: string, language: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Tokenize preserving order
    const tokens: { type: string; value: string }[] = [];
    let remaining = esc(src);

    const patterns: [string, RegExp][] = [
      ['comment', /\/\/[^\n]*/],
      ['comment', /&lt;!--[\s\S]*?--&gt;/],
      ['string', /&quot;[^&]*?&quot;/],
      ['string', /'[^']*?'/],
      ['string', /`[^`]*?`/],
      ['tag', /&lt;\/?[A-Z][a-zA-Z]*(?:\s|\/&gt;|&gt;)/],
      ['attr', /\b(?:dna|name|size|walking|talking|waving)\b(?==)/],
      ['keyword', /\b(?:import|export|from|const|let|var|function|return|if|else|new|type|interface)\b/],
      ['function', /\b[a-zA-Z_]\w*(?=\()/],
      ['type', /\b(?:string|number|boolean|void|null|undefined)\b/],
      ['number', /\b\d+\b/],
    ];

    // Simple sequential tokenizer
    function tokenize(text: string): string {
      if (!text) return '';
      for (const [type, re] of patterns) {
        const match = re.exec(text);
        if (match) {
          const before = text.slice(0, match.index);
          const after = text.slice(match.index + match[0].length);
          const cls = type === 'tag' ? 'hl-tag' :
                      type === 'attr' ? 'hl-attr' :
                      type === 'keyword' ? 'hl-kw' :
                      type === 'string' ? 'hl-str' :
                      type === 'comment' ? 'hl-cmt' :
                      type === 'function' ? 'hl-fn' :
                      type === 'type' ? 'hl-type' :
                      type === 'number' ? 'hl-num' : '';
          return (before ? tokenize(before) : '') +
                 `<span class="${cls}">${match[0]}</span>` +
                 (after ? tokenize(after) : '');
        }
      }
      return text;
    }

    return src.split('\n').map(line => tokenize(esc(line))).join('\n');
  }

  const html = $derived(highlight(code, lang));
</script>

<pre class="code-block"><code>{@html html}</code></pre>

<style>
  pre {
    margin: 0;
  }

  :global(.hl-kw) {
    color: #c792ea;
  }
  :global(.hl-str) {
    color: #c3e88d;
  }
  :global(.hl-cmt) {
    color: rgba(167, 243, 208, 0.35);
    font-style: italic;
  }
  :global(.hl-fn) {
    color: #82aaff;
  }
  :global(.hl-tag) {
    color: #f07178;
  }
  :global(.hl-attr) {
    color: #ffcb6b;
  }
  :global(.hl-type) {
    color: #ffcb6b;
  }
  :global(.hl-num) {
    color: #f78c6c;
  }
</style>
