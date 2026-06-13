/**
 * Maestro — PDF Generator.
 */
import PDFDocument from 'pdfkit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentClient = any;

export async function composeAndUploadBrief(
  client: AgentClient,
  orderId: string,
  topic: string,
  draft: string,
  score: number,
  gaps: string[],
  summonResult?: { approved?: boolean; by?: string }
): Promise<{ brief: string; pdfKey?: string }> {

  const finalBrief = `# Vetted Research Brief: ${topic}\n\n**Quality Score:** ${score}/100\n**Human Approval:** ${summonResult ? (summonResult.approved ? '✅ ' + summonResult.by : 'Rejected') : 'Not Required'}\n\n## Research\n${draft}\n\n## Known Gaps\n${gaps.join('\n')}`;

  // PDF Generation
  console.log(`[maestro/composer] Generating PDF artifact...`);
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    doc.fontSize(20).text('Maestro Vetted Brief', { align: 'center' }).moveDown();
    doc.fontSize(14).text(`Topic: ${topic}`).moveDown(0.5);
    doc.fontSize(12).text(`Quality Score: ${score}/100`);
    if (summonResult?.approved) {
      doc.fillColor('green').text(`Human Approved: ✅ by ${summonResult.by}`).fillColor('black');
    }
    doc.moveDown().fontSize(11).fillColor('black').text(finalBrief);
    doc.end();
  });

  // File Delivery Flex
  console.log(`[maestro/composer] Uploading PDF payload to CROO network...`);
  let pdfKey: string | undefined;
  try {
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    pdfKey = await client.uploadFile(`maestro_brief_${orderId}.pdf`, blob);
    console.log(`[maestro] Order ${orderId}: PDF uploaded securely (key: ${pdfKey})`);
  } catch (err) {
    console.warn(`[maestro/composer] Failed to upload PDF:`, err);
  }

  return { brief: finalBrief, pdfKey };
}
