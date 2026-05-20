
const QRGenerator = (() => {

  function getHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function generateSVG(data, size = 128) {
    const matrixSize = 25;
    const cellSize = size / matrixSize;
    const seed = getHash(data);
    const paths = [];

    for (let y = 0; y < matrixSize; y++) {
      for (let x = 0; x < matrixSize; x++) {

        const isAlignment =
          (x < 7 && y < 7) ||
          (x > matrixSize - 8 && y < 7) ||
          (x < 7 && y > matrixSize - 8);

        if (isAlignment) {
          const relX = x < 7 ? x : (x > 13 ? x - (matrixSize - 7) : x);
          const relY = y < 7 ? y : (y > 13 ? y - (matrixSize - 7) : y);

          const border = (relX === 0 || relX === 6 || relY === 0 || relY === 6);
          const center = (relX >= 2 && relX <= 4 && relY >= 2 && relY <= 4);

          if (border || center) {
            paths.push(`M${x * cellSize},${y * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`);
          }
        } else {
          const bitShift = (seed ^ (x * 1337) ^ (y * 7331)) >>> 0;
          const isBlack = (bitShift % 2 === 0);

          if (isBlack) {
            paths.push(`M${x * cellSize},${y * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`);
          }
        }
      }
    }

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <path d="${paths.join(' ')}" fill="#0F172A"/> 
      </svg>`;
  }

  return { generateSVG };
})();

window.QRGenerator = QRGenerator;