import {
  createRenderer,
  render,
  isDeckRenderError,
  type BrowserInput,
  type BrowserRenderResult,
} from '@deckflow/deckrender/browser';

declare const file: File;
declare const token: string;
const inputs: BrowserInput[] = [
  file,
  { data: new Blob(['x']), name: 'deck.pptx' },
  { data: new Uint8Array([1]), name: 'deck.pptx' },
  { data: new ArrayBuffer(1), name: 'deck.pptx' },
  { html: '<h1>Title</h1>', baseUrl: 'https://example.com/' },
  { markdown: '# Title' },
];
const renderer = createRenderer({ getToken: async () => token });
for (const input of inputs) {
  const promise: Promise<BrowserRenderResult> = renderer.render({ input, pages: '1-3', width: 1920 });
  promise
    .then(async (result) => {
      const url: string | undefined = result.outputs[0]?.url;
      const blob: Blob | undefined = await result.outputs[0]?.blob();
      void url;
      void blob;
      result.dispose();
    })
    .catch((error: unknown) => {
      if (isDeckRenderError(error)) console.log(error.code, error.hint);
    });
}
void render({ guest: true, input: file });
// @ts-expect-error Filesystem paths are not browser inputs.
void renderer.render({ input: './deck.pptx' });
// @ts-expect-error Browser cannot request the native local engine.
void renderer.render({ input: file, engine: 'local' });
// @ts-expect-error Browser cannot write to disk.
void renderer.render({ input: file, out: './output' });
// @ts-expect-error Long-lived API keys belong on the server.
createRenderer({ apiKey: 'secret' });
// @ts-expect-error No Node globals are available in this consumer.
void Buffer;
// @ts-expect-error No Node globals are available in this consumer.
void process;
