
import { AppCredential, User, ClientDBRow } from '../types';
import { supabase } from './clientService';
import { getAllClients } from './clientService';

const CREDENTIAL_LIMITS: Record<string, number> = {
    'viki': 5,
    'kocowa': 7,
    'iqiyi': 20,
    'wetv': 9999,
    'dramabox': 9999,
    'default': 5
};

export const fetchCredentials = async (): Promise<AppCredential[]> => {
    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('*');
        
        if (error) {
            console.error("Erro ao buscar credenciais do Supabase:", error.message || error);
            return [];
        }
        if (!data) return [];

        return data.map((row: any) => ({
            id: row.id,
            service: row.service,
            email: row.email,
            password: row.password,
            publishedAt: row.published_at,
            isVisible: row.is_visible
        }));
    } catch (e: any) {
        console.error("Exceção ao buscar credenciais:", e.message || e);
        return [];
    }
};

export const saveCredential = async (cred: AppCredential): Promise<string | null> => {
    try {
        const payload: any = {
            service: cred.service,
            email: cred.email,
            password: cred.password,
            published_at: cred.publishedAt,
            is_visible: cred.isVisible
        };

        if (cred.id && cred.id.trim() !== '') {
            payload.id = cred.id;
        }

        const { data, error } = await supabase
            .from('credentials')
            .upsert(payload)
            .select()
            .single();

        if (error) {
            console.error("Erro ao salvar credencial:", error.message);
            return null;
        }
        return data.id;
    } catch (e: any) {
        console.error("Exceção ao salvar credencial:", e.message);
        return null;
    }
};

export const deleteCredential = async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('credentials').delete().eq('id', id);
    return !error;
};

// --- ESTRATÉGIA DE DISTRIBUIÇÃO DINÂMICA (LOAD BALANCING) ---

/**
 * Calculates assignment based on total active clients vs total credentials.
 * Logic: Round Robin.
 * Client 1 -> Cred 1
 * Client 2 -> Cred 2
 * Client 3 -> Cred 1 (if only 2 creds)
 * This automatically balances users.
 */
export const getAssignedCredential = async (user: User, serviceName: string, preloadedClients?: ClientDBRow[]): Promise<{ credential: AppCredential | null, alert: string | null, daysActive: number }> => {
  
  const credentialsList = await fetchCredentials();
  const cleanServiceName = serviceName.split('|')[0].trim().toLowerCase();

  // Filter valid credentials for this service
  const serviceCreds = credentialsList
    .filter(c => {
        if (!c.isVisible) return false;
        if (c.email.toLowerCase().includes('demo')) return false;
        const dbService = c.service.toLowerCase();
        return dbService.includes(cleanServiceName) || cleanServiceName.includes(dbService);
    })
    // Sort by creation date to ensure stability (older accounts first in the array)
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

  if (serviceCreds.length === 0) return { credential: null, alert: "Nenhuma conta disponível.", daysActive: 0 };

  // 2. FETCH ALL CLIENTS TO DETERMINE RANK
  const allClients = preloadedClients || await getAllClients();
  
  // Filter clients who have this service active and sort them deterministically (by ID or Phone)
  const activeClientsWithService = allClients
      .filter(c => !c.deleted && c.subscriptions.some(s => s.toLowerCase().includes(cleanServiceName)))
      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

  // Find index of current user
  const userIndex = activeClientsWithService.findIndex(c => c.phone_number === user.phoneNumber);
  
  let assignedCred: AppCredential;

  if (userIndex === -1) {
      // Fallback if user just subscribed and list isn't updated yet, assign to first with least load
      assignedCred = serviceCreds[0];
  } else {
      // ROUND ROBIN ALGORITHM
      // Index % TotalCreds distributes users evenly across all available credentials
      const credIndex = userIndex % serviceCreds.length;
      assignedCred = serviceCreds[credIndex];
  }

  // CHECK LIMITS & ALERTS
  const limit = getLimitForService(cleanServiceName);
  // Calculate how many people are effectively on this credential
  const usersOnThisCred = activeClientsWithService.filter((_, idx) => idx % serviceCreds.length === serviceCreds.indexOf(assignedCred)).length;

  let alertMsg = null;
  if (usersOnThisCred > limit) {
      alertMsg = `⚠️ Conta sobrecarregada! (${usersOnThisCred}/${limit} usuários). Notifique o suporte.`;
  }

  const health = calculateHealth(assignedCred, serviceName);
  
  return { 
      credential: assignedCred, 
      alert: alertMsg || health.alert, 
      daysActive: health.daysActive 
  };
};

const getLimitForService = (serviceName: string): number => {
    const s = serviceName.toLowerCase();
    if (s.includes('viki')) return CREDENTIAL_LIMITS['viki'];
    if (s.includes('kocowa')) return CREDENTIAL_LIMITS['kocowa'];
    if (s.includes('iqiyi')) return CREDENTIAL_LIMITS['iqiyi'];
    if (s.includes('wetv')) return CREDENTIAL_LIMITS['wetv'];
    if (s.includes('dramabox')) return CREDENTIAL_LIMITS['dramabox'];
    return CREDENTIAL_LIMITS['default'];
};

const calculateHealth = (cred: AppCredential, serviceName: string) => {
  const dateCreated = new Date(cred.publishedAt);
  const today = new Date();
  dateCreated.setHours(0,0,0,0);
  today.setHours(0,0,0,0);
  
  const diffTime = today.getTime() - dateCreated.getTime();
  const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  let alertMsg = null;
  const sName = serviceName.toLowerCase();

  // Expiração temporal (além da quantidade de usuários)
  if (sName.includes('viki')) {
      if (daysPassed >= 14) alertMsg = "⚠️ Conta Expirada (14 Dias).";
      else if (daysPassed === 13) alertMsg = "⚠️ Último dia do ciclo!";
  } 
  else if (sName.includes('kocowa')) {
      if (daysPassed >= 30) alertMsg = "⚠️ Conta Expirada (30 Dias).";
  }

  return { alert: alertMsg, daysActive: daysPassed };
};

/**
 * Calculates current usage stats for Admin Panel
 */
export const getClientsUsingCredential = async (credential: AppCredential, clients: ClientDBRow[]): Promise<ClientDBRow[]> => {
    // We need to re-simulate the distribution for the whole system to see who lands on this credential
    const credServiceLower = credential.service.toLowerCase().split('|')[0].trim();
    
    // 1. Get all creds for this service to establish the rotation order
    const allCreds = await fetchCredentials();
    const serviceCreds = allCreds
        .filter(c => c.isVisible && !c.email.includes('demo') && c.service.toLowerCase().includes(credServiceLower))
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    
    const myIndex = serviceCreds.findIndex(c => c.id === credential.id);
    
    if (myIndex === -1) return []; // Should not happen

    // 2. Get all clients for this service sorted
    const activeClientsWithService = clients
      .filter(c => !c.deleted && c.subscriptions.some(s => s.toLowerCase().includes(credServiceLower)))
      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));

    // 3. Filter clients who map to this credential index
    return activeClientsWithService.filter((_, idx) => idx % serviceCreds.length === myIndex);
};
