import { Client, Contract, Employee } from '../models/time-tracker.models';

/** Contract for this member on this client, if one exists. */
export function findContract(contracts: Contract[], employeeId: string, clientId: string): Contract | undefined {
  return contracts.find((c) => c.active && c.employeeId === employeeId && c.clientId === clientId);
}

/** What Auravia pays this member per hour on this client. */
export function payRateFor(contracts: Contract[], employee: Employee | undefined, clientId: string): number {
  if (!employee) return 0;
  return findContract(contracts, employee.id, clientId)?.payRate ?? employee.hourlyRate ?? 0;
}

/** What Auravia charges this client per hour for this member's time. */
export function billRateFor(contracts: Contract[], clients: Client[], employeeId: string, clientId: string): number {
  const contract = findContract(contracts, employeeId, clientId);
  if (contract) return contract.billRate || 0;
  return clients.find((c) => c.id === clientId)?.defaultRate || 0;
}
