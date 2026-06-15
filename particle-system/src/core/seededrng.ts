export async function mulberry32(input: number | string) {
    console.log("Input seed was: " + input)
    let seed: number;
    if (typeof input === "string") {
        const hash = await stringHash(input)
        console.log("Hash is: " + hash)
        seed = hashToSeed(hash)
        console.log("Computed seed is: " + seed)
    } else {
        seed = input
    }
    

    return function() {
      var t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
async function stringHash(str: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await window.crypto.subtle.digest("SHA-256", data);
    return hash;
} 
function hashToSeed(hash: ArrayBuffer): number {
    const view = new DataView(hash);
    return view.getInt32(0)
}