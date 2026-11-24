import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ANCHO = 540;
const ALTO = 720;
const CREMA = rgb(0.965, 0.941, 0.9);
const TINTA = rgb(0.29, 0.18, 0.14);
const ORO = rgb(0.69, 0.53, 0.39);
const ORO_CLARO = rgb(0.8, 0.67, 0.52);
const SUAVE = rgb(0.55, 0.44, 0.36);

const TECNICAS = [
  ["assets/catalogo/clip-in.jpg", "Clip In"],
  ["assets/catalogo/tape-in.jpg", "Tape In"],
  ["assets/catalogo/hand-tied.jpg", "Hand-Tied"],
  ["assets/catalogo/adam-veil.jpg", "Adam Veil"],
  ["assets/catalogo/ponytail.jpg", "Ponytail"],
];

const pdf = await PDFDocument.create();
const romana = await pdf.embedFont(StandardFonts.TimesRoman);
const negrita = await pdf.embedFont(StandardFonts.TimesRomanBold);
const cursiva = await pdf.embedFont(StandardFonts.TimesRomanItalic);

const portada = pdf.addPage([ANCHO, ALTO]);
portada.drawRectangle({ x: 0, y: 0, width: ANCHO, height: ALTO, color: CREMA });
portada.drawRectangle({
  x: 24,
  y: 24,
  width: ANCHO - 48,
  height: ALTO - 48,
  borderColor: ORO,
  borderWidth: 0.9,
});
portada.drawRectangle({
  x: 30,
  y: 30,
  width: ANCHO - 60,
  height: ALTO - 60,
  borderColor: ORO_CLARO,
  borderWidth: 0.4,
});

rastrear(portada, negrita, "EXTENSIONES GUATEMALA", 575, 11, TINTA, 1.4);
centrar(portada, romana, "HUMAN HAIR EXTENSIONS", 556, 8, ORO);
portada.drawLine({
  start: { x: 205, y: 540 },
  end: { x: 335, y: 540 },
  thickness: 0.7,
  color: ORO,
});
centrar(portada, cursiva, "Catálogo", 488, 46, TINTA);
centrar(portada, romana, "de cabello", 456, 18, SUAVE);

let fila = 390;
for (const [, nombre] of TECNICAS) {
  portada.drawCircle({ x: 188, y: fila + 4, size: 2.2, color: ORO });
  portada.drawText(nombre, { x: 204, y: fila, size: 16, font: negrita, color: TINTA });
  fila -= 32;
}

portada.drawLine({
  start: { x: 170, y: 214 },
  end: { x: 370, y: 214 },
  thickness: 0.6,
  color: ORO_CLARO,
});
centrar(portada, cursiva, "Para reservar", 186, 13, SUAVE);
centrar(portada, negrita, "WhatsApp 3992 1868", 164, 14, TINTA);
centrar(portada, romana, "extensiones.guatemala.com", 142, 9, ORO);

for (const [ruta] of TECNICAS) {
  const pagina = pdf.addPage([ANCHO, ALTO]);
  pagina.drawRectangle({ x: 0, y: 0, width: ANCHO, height: ALTO, color: CREMA });
  const jpg = await pdf.embedJpg(fs.readFileSync(ruta));
  const marco = 22;
  const maximoAncho = ANCHO - marco * 2;
  const maximoAlto = ALTO - marco * 2;
  const escala = Math.min(maximoAncho / jpg.width, maximoAlto / jpg.height);
  const ancho = jpg.width * escala;
  const alto = jpg.height * escala;
  const x = (ANCHO - ancho) / 2;
  const y = (ALTO - alto) / 2;
  pagina.drawImage(jpg, { x, y, width: ancho, height: alto });
  pagina.drawRectangle({ x, y, width: ancho, height: alto, borderColor: ORO, borderWidth: 0.7 });
}

const bytes = await pdf.save();
fs.mkdirSync("assets", { recursive: true });
fs.writeFileSync("assets/catalogo-extensiones.pdf", bytes);
const base64 = Buffer.from(bytes).toString("base64");
fs.writeFileSync(
  "src/catalogo-pdf.ts",
  `export const NOMBRE_CATALOGO = "Catalogo-de-cabello.pdf";\n\nexport const PIE_CATALOGO =\n  "Ve el catálogo de cabello. Están Clip In, Tape In, Hand-Tied, Adam Veil y Ponytail. Para reservar, escribe al WhatsApp 3992 1868.";\n\nconst BASE64 =\n  "${base64}";\n\nexport function bytesCatalogo(): Uint8Array {\n  const binario = atob(BASE64);\n  const bytes = new Uint8Array(binario.length);\n  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);\n  return bytes;\n}\n`,
);
console.log(`pdf ${bytes.length} paginas ${pdf.getPageCount()}`);

function centrar(pagina, fuente, texto, y, tamano, color) {
  const ancho = fuente.widthOfTextAtSize(texto, tamano);
  pagina.drawText(texto, { x: (ANCHO - ancho) / 2, y, size: tamano, font: fuente, color });
}

function rastrear(pagina, fuente, texto, y, tamano, color, extra) {
  const letras = [...texto];
  const ancho =
    letras.reduce((suma, letra) => suma + fuente.widthOfTextAtSize(letra, tamano) + extra, 0) - extra;
  let x = (ANCHO - ancho) / 2;
  for (const letra of letras) {
    pagina.drawText(letra, { x, y, size: tamano, font: fuente, color });
    x += fuente.widthOfTextAtSize(letra, tamano) + extra;
  }
}
