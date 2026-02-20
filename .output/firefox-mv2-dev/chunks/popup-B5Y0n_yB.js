(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) return;
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) processPreload(link);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
    }
  }).observe(document, {
    childList: true,
    subtree: true
  });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep) return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
function print(method, ...args) {
  if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
  else method("[wxt]", ...args);
}
const logger = {
  debug: (...args) => print(console.debug, ...args),
  log: (...args) => print(console.log, ...args),
  warn: (...args) => print(console.warn, ...args),
  error: (...args) => print(console.error, ...args)
};
let ws;
function getDevServerWebSocket() {
  if (ws == null) {
    const serverUrl = "ws://localhost:3001";
    logger.debug("Connecting to dev server @", serverUrl);
    ws = new WebSocket(serverUrl, "vite-hmr");
    ws.addWxtEventListener = ws.addEventListener.bind(ws);
    ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
      type: "custom",
      event,
      payload
    }));
    ws.addEventListener("open", () => {
      logger.debug("Connected to dev server");
    });
    ws.addEventListener("close", () => {
      logger.debug("Disconnected from dev server");
    });
    ws.addEventListener("error", (event) => {
      logger.error("Failed to connect to dev server", event);
    });
    ws.addEventListener("message", (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
      } catch (err) {
        logger.error("Failed to handle message", err);
      }
    });
  }
  return ws;
}
try {
  getDevServerWebSocket().addWxtEventListener("wxt:reload-page", (event) => {
    if (event.detail === location.pathname.substring(1)) location.reload();
  });
} catch (err) {
  logger.error("Failed to setup web socket connection with dev server", err);
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9wdXAtQjVZMG5feUIuanMiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC92aXJ0dWFsL3JlbG9hZC1odG1sLm1qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyNyZWdpb24gc3JjL3V0aWxzL2ludGVybmFsL2xvZ2dlci50c1xuZnVuY3Rpb24gcHJpbnQobWV0aG9kLCAuLi5hcmdzKSB7XG5cdGlmIChpbXBvcnQubWV0YS5lbnYuTU9ERSA9PT0gXCJwcm9kdWN0aW9uXCIpIHJldHVybjtcblx0aWYgKHR5cGVvZiBhcmdzWzBdID09PSBcInN0cmluZ1wiKSBtZXRob2QoYFt3eHRdICR7YXJncy5zaGlmdCgpfWAsIC4uLmFyZ3MpO1xuXHRlbHNlIG1ldGhvZChcIlt3eHRdXCIsIC4uLmFyZ3MpO1xufVxuLyoqXG4qIFdyYXBwZXIgYXJvdW5kIGBjb25zb2xlYCB3aXRoIGEgXCJbd3h0XVwiIHByZWZpeFxuKi9cbmNvbnN0IGxvZ2dlciA9IHtcblx0ZGVidWc6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmRlYnVnLCAuLi5hcmdzKSxcblx0bG9nOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5sb2csIC4uLmFyZ3MpLFxuXHR3YXJuOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS53YXJuLCAuLi5hcmdzKSxcblx0ZXJyb3I6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmVycm9yLCAuLi5hcmdzKVxufTtcblxuLy8jZW5kcmVnaW9uXG4vLyNyZWdpb24gc3JjL3V0aWxzL2ludGVybmFsL2Rldi1zZXJ2ZXItd2Vic29ja2V0LnRzXG5sZXQgd3M7XG4vKipcbiogQ29ubmVjdCB0byB0aGUgd2Vic29ja2V0IGFuZCBsaXN0ZW4gZm9yIG1lc3NhZ2VzLlxuKi9cbmZ1bmN0aW9uIGdldERldlNlcnZlcldlYlNvY2tldCgpIHtcblx0aWYgKGltcG9ydC5tZXRhLmVudi5DT01NQU5EICE9PSBcInNlcnZlXCIpIHRocm93IEVycm9yKFwiTXVzdCBiZSBydW5uaW5nIFdYVCBkZXYgY29tbWFuZCB0byBjb25uZWN0IHRvIGNhbGwgZ2V0RGV2U2VydmVyV2ViU29ja2V0KClcIik7XG5cdGlmICh3cyA9PSBudWxsKSB7XG5cdFx0Y29uc3Qgc2VydmVyVXJsID0gX19ERVZfU0VSVkVSX09SSUdJTl9fO1xuXHRcdGxvZ2dlci5kZWJ1ZyhcIkNvbm5lY3RpbmcgdG8gZGV2IHNlcnZlciBAXCIsIHNlcnZlclVybCk7XG5cdFx0d3MgPSBuZXcgV2ViU29ja2V0KHNlcnZlclVybCwgXCJ2aXRlLWhtclwiKTtcblx0XHR3cy5hZGRXeHRFdmVudExpc3RlbmVyID0gd3MuYWRkRXZlbnRMaXN0ZW5lci5iaW5kKHdzKTtcblx0XHR3cy5zZW5kQ3VzdG9tID0gKGV2ZW50LCBwYXlsb2FkKSA9PiB3cz8uc2VuZChKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHR0eXBlOiBcImN1c3RvbVwiLFxuXHRcdFx0ZXZlbnQsXG5cdFx0XHRwYXlsb2FkXG5cdFx0fSkpO1xuXHRcdHdzLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsICgpID0+IHtcblx0XHRcdGxvZ2dlci5kZWJ1ZyhcIkNvbm5lY3RlZCB0byBkZXYgc2VydmVyXCIpO1xuXHRcdH0pO1xuXHRcdHdzLmFkZEV2ZW50TGlzdGVuZXIoXCJjbG9zZVwiLCAoKSA9PiB7XG5cdFx0XHRsb2dnZXIuZGVidWcoXCJEaXNjb25uZWN0ZWQgZnJvbSBkZXYgc2VydmVyXCIpO1xuXHRcdH0pO1xuXHRcdHdzLmFkZEV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCAoZXZlbnQpID0+IHtcblx0XHRcdGxvZ2dlci5lcnJvcihcIkZhaWxlZCB0byBjb25uZWN0IHRvIGRldiBzZXJ2ZXJcIiwgZXZlbnQpO1xuXHRcdH0pO1xuXHRcdHdzLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIChlKSA9PiB7XG5cdFx0XHR0cnkge1xuXHRcdFx0XHRjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShlLmRhdGEpO1xuXHRcdFx0XHRpZiAobWVzc2FnZS50eXBlID09PSBcImN1c3RvbVwiKSB3cz8uZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQobWVzc2FnZS5ldmVudCwgeyBkZXRhaWw6IG1lc3NhZ2UuZGF0YSB9KSk7XG5cdFx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdFx0bG9nZ2VyLmVycm9yKFwiRmFpbGVkIHRvIGhhbmRsZSBtZXNzYWdlXCIsIGVycik7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblx0cmV0dXJuIHdzO1xufVxuXG4vLyNlbmRyZWdpb25cbi8vI3JlZ2lvbiBzcmMvdmlydHVhbC9yZWxvYWQtaHRtbC50c1xuaWYgKGltcG9ydC5tZXRhLmVudi5DT01NQU5EID09PSBcInNlcnZlXCIpIHRyeSB7XG5cdGdldERldlNlcnZlcldlYlNvY2tldCgpLmFkZFd4dEV2ZW50TGlzdGVuZXIoXCJ3eHQ6cmVsb2FkLXBhZ2VcIiwgKGV2ZW50KSA9PiB7XG5cdFx0aWYgKGV2ZW50LmRldGFpbCA9PT0gbG9jYXRpb24ucGF0aG5hbWUuc3Vic3RyaW5nKDEpKSBsb2NhdGlvbi5yZWxvYWQoKTtcblx0fSk7XG59IGNhdGNoIChlcnIpIHtcblx0bG9nZ2VyLmVycm9yKFwiRmFpbGVkIHRvIHNldHVwIHdlYiBzb2NrZXQgY29ubmVjdGlvbiB3aXRoIGRldiBzZXJ2ZXJcIiwgZXJyKTtcbn1cblxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyAgfTsiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxTQUFTLE1BQU0sV0FBVyxNQUFNO0FBRS9CLE1BQUksT0FBTyxLQUFLLENBQUMsTUFBTSxTQUFVLFFBQU8sU0FBUyxLQUFLLE1BQUEsQ0FBTyxJQUFJLEdBQUcsSUFBSTtBQUFBLE1BQ25FLFFBQU8sU0FBUyxHQUFHLElBQUk7QUFDN0I7QUFJQSxNQUFNLFNBQVM7QUFBQSxFQUNkLE9BQU8sSUFBSSxTQUFTLE1BQU0sUUFBUSxPQUFPLEdBQUcsSUFBSTtBQUFBLEVBQ2hELEtBQUssSUFBSSxTQUFTLE1BQU0sUUFBUSxLQUFLLEdBQUcsSUFBSTtBQUFBLEVBQzVDLE1BQU0sSUFBSSxTQUFTLE1BQU0sUUFBUSxNQUFNLEdBQUcsSUFBSTtBQUFBLEVBQzlDLE9BQU8sSUFBSSxTQUFTLE1BQU0sUUFBUSxPQUFPLEdBQUcsSUFBSTtBQUNqRDtBQUlBLElBQUk7QUFJSixTQUFTLHdCQUF3QjtBQUVoQyxNQUFJLE1BQU0sTUFBTTtBQUNmLFVBQU0sWUFBWTtBQUNsQixXQUFPLE1BQU0sOEJBQThCLFNBQVM7QUFDcEQsU0FBSyxJQUFJLFVBQVUsV0FBVyxVQUFVO0FBQ3hDLE9BQUcsc0JBQXNCLEdBQUcsaUJBQWlCLEtBQUssRUFBRTtBQUNwRCxPQUFHLGFBQWEsQ0FBQyxPQUFPLFlBQVksSUFBSSxLQUFLLEtBQUssVUFBVTtBQUFBLE1BQzNELE1BQU07QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLElBQUEsQ0FDQSxDQUFDO0FBQ0YsT0FBRyxpQkFBaUIsUUFBUSxNQUFNO0FBQ2pDLGFBQU8sTUFBTSx5QkFBeUI7QUFBQSxJQUN2QyxDQUFDO0FBQ0QsT0FBRyxpQkFBaUIsU0FBUyxNQUFNO0FBQ2xDLGFBQU8sTUFBTSw4QkFBOEI7QUFBQSxJQUM1QyxDQUFDO0FBQ0QsT0FBRyxpQkFBaUIsU0FBUyxDQUFDLFVBQVU7QUFDdkMsYUFBTyxNQUFNLG1DQUFtQyxLQUFLO0FBQUEsSUFDdEQsQ0FBQztBQUNELE9BQUcsaUJBQWlCLFdBQVcsQ0FBQyxNQUFNO0FBQ3JDLFVBQUk7QUFDSCxjQUFNLFVBQVUsS0FBSyxNQUFNLEVBQUUsSUFBSTtBQUNqQyxZQUFJLFFBQVEsU0FBUyxTQUFVLEtBQUksY0FBYyxJQUFJLFlBQVksUUFBUSxPQUFPLEVBQUUsUUFBUSxRQUFRLEtBQUEsQ0FBTSxDQUFDO0FBQUEsTUFDMUcsU0FBUyxLQUFLO0FBQ2IsZUFBTyxNQUFNLDRCQUE0QixHQUFHO0FBQUEsTUFDN0M7QUFBQSxJQUNELENBQUM7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNSO0FBSXlDLElBQUk7QUFDNUMsMEJBQXdCLG9CQUFvQixtQkFBbUIsQ0FBQyxVQUFVO0FBQ3pFLFFBQUksTUFBTSxXQUFXLFNBQVMsU0FBUyxVQUFVLENBQUMsWUFBWSxPQUFBO0FBQUEsRUFDL0QsQ0FBQztBQUNGLFNBQVMsS0FBSztBQUNiLFNBQU8sTUFBTSx5REFBeUQsR0FBRztBQUMxRTsiLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMF19
