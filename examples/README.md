# Examples

## Shell

Thumbnail the first page of a PDF:

```bash
deckrender report.pdf --page 1 --width 640 -o thumb.png
```

Web-ready frames from a deck:

```bash
deckrender deck.pptx --profile web -o frames/
```

Ship a page range as one archive:

```bash
deckrender deck.pptx --pages 1-10 --image-format webp -o preview.zip
```

Screenshot a live page:

```bash
deckrender https://example.com -o shot.png
```

Render HTML produced by another process:

```bash
my-generator | deckrender - --from html -o slide.png
```

## Scripting

Capture the output path:

```bash
FIRST=$(deckrender deck.pptx --json | jq -r '.outputs[0].file')
```

Inspect the backend task chain a render used:

```bash
deckrender report.docx --format image --json | jq -r '.route | join(" -> ")'
# convertor.doc2pdf -> convertor.pdf2image
```

Branch on the failure kind:

```bash
if ! deckrender "$INPUT" -o out.pdf --json 2> err.json; then
  case "$(jq -r '.error.code' err.json)" in
    unsupported_format) echo "cannot render $INPUT to pdf" ;;
    auth_error)         echo "run: deckrender auth login" ;;
    *)                  jq -r '.error.message' err.json ;;
  esac
fi
```

Check what a file can become before trying:

```bash
deckrender formats --json | jq -r '.matrix.docx | to_entries[] | select(.value.supported) | .key'
# image
# pdf
```

## Library

```ts
import { render } from '@deckflow/deckrender';

const result = await render({
  input: 'deck.pptx',
  format: 'image',
  pages: '1-10',
  imageFormat: 'webp',
  out: 'frames/',
});

console.log(result.route);   // ['convertor.ppt2image', 'image.convertWebp']
console.log(result.pages);   // total pages, before --pages filtering
```

Reuse configuration across renders and surface warnings:

```ts
import { createRenderer } from '@deckflow/deckrender';

const renderer = createRenderer({
  apiKey: process.env.DECKFLOW_API_KEY,
  onWarning: (message) => console.warn(message),
});

for (const file of files) {
  await renderer.render({ input: file, format: 'pdf' });
}
```

Handle failures by code:

```ts
import { render, isDeckRenderError } from '@deckflow/deckrender';

try {
  await render({ input: 'report.pdf', format: 'video' });
} catch (error) {
  if (isDeckRenderError(error) && error.code === 'unsupported_format') {
    console.error(error.message, error.hint);
  } else {
    throw error;
  }
}
```

Ask what is possible without rendering:

```ts
import { supportedTargets, findRoute } from '@deckflow/deckrender';

supportedTargets('docx');          // ['image', 'pdf']
findRoute('docx', 'image')?.kind;  // 'derived'
```
