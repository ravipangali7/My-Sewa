/** 1-based serial number for paginated lists: (page - 1) * pageSize + index + 1 */
export function serialNumber(page: number, pageSize: number, index: number): number {
  return (page - 1) * pageSize + index + 1;
}
