export const exportMeta = {
  slaebFormulaText: ''
};

export function setSlaebFormulaText (text) {
  exportMeta.slaebFormulaText = typeof text === 'string' ? text : '';
}
