// Temporary diagnostic logging for the stuck-placement investigation (debug-placement
// branch only, never for release). Lines are prefixed KDBG so a session trace is one
// grep away:  journalctl --user -f | grep KDBG
function kdbg(message: string) {
    console.warn("KDBG " + message);
}

function kdbgWin(kwinClient: KwinClient) {
    return kwinClient.resourceClass + String(kwinClient.internalId).slice(0, 9);
}

function kdbgRect(rect: QmlRect) {
    return Math.round(rect.x) + "," + Math.round(rect.y) + " " +
        Math.round(rect.width) + "x" + Math.round(rect.height);
}
