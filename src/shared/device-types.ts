export interface DeviceDataInfo {
  accounts: { path: string; databaseId: string }[];
  financialDirectory: string;
  attachmentDirectory: string;
}
export interface DeviceActionResult { success: boolean; error?: string }
