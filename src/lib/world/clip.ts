// Tells the clip2output KWin effect which screen owns a window, so a column Karousel parks
// outside its own screen is clipped there instead of reappearing on the neighbour. The effect
// only ever clips windows announced through here; everything else keeps stock KWin behaviour.
// Harmlessly does nothing when the effect is not loaded.
function announceClipOwner(kwinClient: KwinClient, screenName: string) {
    // `internalId` is a QUuid, which QDBusMarshaller cannot serialise ("type 'QUuid' is
    // not registered with D-Bus"), and the call then fails silently. Send its string form.
    clipSetOwner.arguments = [String(kwinClient.internalId), screenName];
    clipSetOwner.call();
}

// Releases the window from the effect entirely: an empty owner removes the claim, so the window
// paints wherever it lies - including across the seam, which is what the user expects of anything
// they have taken out of the grid. Called whenever a window leaves the tiled state for a
// user-controlled one. Also runs for windows that were never claimed, where it is a no-op, which
// conveniently heals claims left behind by a previous script session.
function announceClipRelease(kwinClient: KwinClient) {
    announceClipOwner(kwinClient, "");
}
