import type { InvoiceLineItem } from '@/services/invoice-html';

export interface InvoicePDFParams {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  notes: string;
  bankDetails: string;
  isOverdue: boolean;
  logoPath: string;
}

/**
 * Renders invoice HTML and converts to PDF bytes.
 */
export async function generateInvoicePDF(params: InvoicePDFParams): Promise<number[]> {
  let logoDataUri: string | undefined;
  if (params.logoPath) {
    try {
      logoDataUri = await window.api.readFileBase64(params.logoPath);
    } catch {
      // logo file may be missing
    }
  }

  const { renderInvoiceHTML } = await import('@/services/invoice-html');
  const html = renderInvoiceHTML({
    fromName: params.fromName,
    fromAddress: params.fromAddress,
    toName: params.toName,
    toAddress: params.toAddress,
    invoiceNumber: params.invoiceNumber,
    date: params.date,
    dueDate: params.dueDate,
    lineItems: params.lineItems,
    notes: params.notes,
    bankDetails: params.bankDetails,
    isOverdue: params.isOverdue,
    logoDataUri,
  });

  return window.api.printToPDF(html);
}

/**
 * Shows save dialog and writes PDF bytes to the chosen file.
 * Returns true if the file was saved, false if cancelled.
 */
export async function saveInvoicePDF(pdfBytes: number[], invoiceNumber: string): Promise<boolean> {
  const result = await window.api.showSaveDialog({
    title: 'Save Invoice',
    defaultPath: `invoice-${invoiceNumber}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!result.canceled && result.filePath) {
    await window.api.writeFileBinary(result.filePath, pdfBytes);
    return true;
  }
  return false;
}
