// Present only when this page is loaded inside the LobbyKiosk WebView2 host
// (see lobby-kiosk-app) — undefined in a regular browser tab.
interface Window {
  chrome?: {
    webview?: {
      postMessage: (message: string) => void;
    };
  };
}
