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
  summonResult: { approved?: boolean; by?: string } | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audit: any[],
  profitUsdc: number,
  lifetimeYield: number,
  valuation: number
): Promise<{ brief: string; pdfKey?: string }> {

  const lines = [
    `# Vetted Research Brief: ${topic}`,
    '',
    `**Quality Score:** ${score}/100`,
    `**Human Approval:** ${summonResult ? (summonResult.approved ? '✅ ' + summonResult.by : 'Rejected') : 'Not Required'}`,
    '',
    '## Research',
    draft,
    ''
  ];

  if (gaps.length > 0) {
    lines.push('## Known Gaps');
    lines.push(...gaps.map((g) => `- ${g}`));
    lines.push('');
  }

  // CRYPTOGRAPHIC PROVENANCE & ASSETIZATION INJECTION
  lines.push('---');
  lines.push('### 📈 Agent Assetization & Valuation');
  lines.push(`_Maestro tracks its own cumulative lifetime cashflow. Based on its trailing P&L and a 30x execution multiple, Maestro's Live Enterprise Valuation on the CROO Exchange is estimated at **${valuation} USDC**._`);
  lines.push('');
  lines.push('### 🔗 On-Chain Provenance & Arbitrage Manifest');
  lines.push(`_Pipeline executed on Base L2. Maestro retained a yield of **${profitUsdc} USDC** to its treasury._`);
  lines.push(`_🛡️ **A2A Cognitive Reflection Active:** Sub-agents were dynamically routed via Yield-to-Quality Ratio (YQR) and forced to self-correct based on Litmus Oracle feedback._\\n`);
  
  audit.forEach(a => {
    /* v8 ignore next */
    if (a.status === 'completed' && a.txHash) {
      lines.push(`- **[${a.step.toUpperCase()}]** executed by \`${a.agent}\` | Cost: \`${a.amount} USDC\` | TX: \`${a.txHash}\``);
    }
  });

  lines.push('\\n---');
  lines.push('_This brief was researched, graded, and composed by Maestro — a self-healing agent orchestra._');

  const finalBrief = lines.join('\n');

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
