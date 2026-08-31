export function startBrowserFixture(): Promise<{ url: string; close(): Promise<void> }>;
