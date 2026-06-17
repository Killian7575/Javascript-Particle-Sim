export function mulberry32(input: number | string) {
    console.log("Input seed was: " + input)
    let seed: number;
    if (typeof input === "string") {
        seed = stringToSeed(input)
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

function stringToSeed(str: string): number {
    // FNV-1a 32-bit hash, returns unsigned 32-bit integer
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
}
// async function stringHash(str: string) {
//     const encoder = new TextEncoder();
//     const data = encoder.encode(str);
//     const hash = await window.crypto.subtle.digest("SHA-256", data);
//     return hash;
// } 
// function hashToSeed(hash: ArrayBuffer): number {
//     const view = new DataView(hash);
//     return view.getInt32(0)
// }