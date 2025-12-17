
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppCredential, ClientDBRow, User } from '../types';
import { fetchCredentials, saveCredential, deleteCredential, getClientsUsingCredential } from '../services/credentialService';
import { getAllClients, saveClientToDB, deleteClientFromDB, restoreClient, permanentlyDeleteClient, hardDeleteAllClients, resetAllClientPasswords, resetAllNamesAndFixDates } from '../services/clientService';
import { Plus, Trash2, Edit2, LogOut, Users, Search, AlertTriangle, X, ShieldAlert, Key, Activity, Clock, CheckCircle2, RefreshCw, FileUp, MessageCircle, Phone, Copy, Check, Lock, Loader2, Eye, EyeOff, PieChart, Calendar, Download, Upload, Shield, ChevronDown, Filter, Moon, Sun, DollarSign, TrendingUp, ArrowRight, Wallet, ArrowUpRight, ArrowDownRight, Ban } from 'lucide-react';

interface AdminPanelProps {
  onLogout: () => void;
}

const SERVICES = ['Viki Pass', 'Kocowa+', 'IQIYI', 'WeTV', 'DramaBox'];

// PREÇOS ATUALIZADOS
const PRICES: Record<string, number> = {
    'viki': 20.00,
    'kocowa': 15.00,
    'iqiyi': 15.00,
    'wetv': 15.00,
    'dramabox': 15.00,
    'default': 15.00
};

// LIMITES POR CONTA (Para Alertas Visuais)
const LIMITS: Record<string, number> = {
    'viki': 5,
    'kocowa': 7,
    'iqiyi': 20,
    'wetv': 9999,
    'dramabox': 9999
};

// UTILS
const toLocalInput = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    } catch(e) { return ''; }
};

const toDateInput = (isoString: string) => {
    if (!isoString) return new Date().toISOString().split('T')[0];
    try { return isoString.split('T')[0]; } catch(e) { return ''; }
};

const normalizeSubscriptions = (subs: string | string[]): string[] => {
    let list: string[] = [];
    if (Array.isArray(subs)) list = subs;
    else if (typeof subs === 'string') {
        let cleaned = subs.replace(/^\{|\}$/g, '');
        if (!cleaned) list = [];
        else if (cleaned.includes(';')) list = cleaned.split(';'); 
        else if (cleaned.includes(',')) list = cleaned.split(',');
        else if (cleaned.includes('+')) list = cleaned.split('+');
        else list = [cleaned];
    }
    
    return list
        .map(s => s.trim().replace(/^"|"$/g, ''))
        .filter(s => s.length > 0 && s.toLowerCase() !== 'null' && s !== '""');
};

const calculateExpiry = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date(); 
    d.setMonth(d.getMonth() + months);
    return d;
};

const getDaysRemaining = (expiryDate: Date) => {
    const now = new Date();
    expiryDate.setHours(0,0,0,0);
    now.setHours(0,0,0,0);
    return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const getCredentialHealth = (service: string, publishedAt: string) => {
    const pubDate = new Date(publishedAt);
    const now = new Date();
    const diffTime = now.getTime() - pubDate.getTime();
    const daysActive = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let limit = 30;
    const s = service.toLowerCase();

    if (s.includes('viki')) limit = 14;
    else if (s.includes('kocowa')) limit = 25;
    
    const daysRemaining = limit - daysActive;

    if (daysRemaining < 0) return { label: 'Expirado', color: 'text-red-500 bg-red-50 border-red-100 dark:bg-red-900/40 dark:border-red-800 dark:text-red-300', icon: <AlertTriangle size={16}/> };
    if (daysRemaining <= 3) return { label: `${daysRemaining} dias rest.`, color: 'text-orange-600 bg-orange-50 border-orange-100 dark:bg-orange-900/40 dark:border-orange-800 dark:text-orange-300', icon: <Clock size={16}/> };
    
    return { label: `${daysRemaining} dias rest.`, color: 'text-green-600 bg-green-50 border-green-100 dark:bg-green-900/40 dark:border-green-800 dark:text-green-300', icon: <CheckCircle2 size={16}/> };
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'clients' | 'credentials' | 'finance' | 'search_client' | 'danger'>('clients'); 
  const [clientFilterStatus, setClientFilterStatus] = useState<'all' | 'active' | 'expiring' | 'debtor' | 'trash'>('all');
  const [darkMode, setDarkMode] = useState(false);

  const [credentials, setCredentials] = useState<AppCredential[]>([]);
  const [clients, setClients] = useState<ClientDBRow[]>([]);
  const [credentialUsage, setCredentialUsage] = useState<Record<string, number>>({});
  
  const [loading, setLoading] = useState(false);
  const [processingAction, setProcessingAction] = useState(false); 
  const [savingClient, setSavingClient] = useState(false);

  const [clientSearch, setClientSearch] = useState('');
  
  // Bulk Import
  const [showBulkImport, setShowBulkImport] = useState(false); 
  const [bulkService, setBulkService] = useState(SERVICES[0]);
  const [bulkText, setBulkText] = useState('');
  const [bulkDate, setBulkDate] = useState(toDateInput(new Date().toISOString()));
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [credForm, setCredForm] = useState<Partial<AppCredential>>({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
  
  const [clientModalOpen, setClientModalOpen] = useState(false);
  
  // Search Client Logic (Reverse Lookup)
  const [searchClientTerm, setSearchClientTerm] = useState('');
  const [searchedClientData, setSearchedClientData] = useState<{
      client: ClientDBRow, 
      accounts: {
          service: string, 
          email: string, 
          password: string,
          isBlocked: boolean,
          expiryDate: Date
      }[]
  } | null>(null);

  // Financial Projection State
  const [analysisDays, setAnalysisDays] = useState(7);
  const [projectionDays, setProjectionDays] = useState(30);

  // Confirmation Modal
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ 
      title: string; 
      message: React.ReactNode; 
      confirmLabel: string; 
      requiresInput?: boolean;
      inputPlaceholder?: string;
      validationValue?: string;
      onConfirm: () => Promise<void> 
  } | null>(null);

  const [clientForm, setClientForm] = useState<Partial<ClientDBRow>>({
      phone_number: '', client_name: '', client_password: '', subscriptions: [], duration_months: 1, is_debtor: false, is_contacted: false, purchase_date: toLocalInput(new Date().toISOString()), manual_credentials: {}
  });
  const [newSubService, setNewSubService] = useState(SERVICES[0]);
  const [newSubDate, setNewSubDate] = useState(toDateInput(new Date().toISOString()));
  
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
      // Recalculate usage whenever data changes using the dynamic load balancing logic
      const calculateUsage = async () => {
          if (credentials.length > 0 && clients.length > 0) {
              const usage: Record<string, number> = {};
              credentials.forEach(c => usage[c.id] = 0);

              // Optimized local calculation instead of individual async calls
              const activeClients = clients.filter(c => !c.deleted);
              
              activeClients.forEach(client => {
                  const subs = normalizeSubscriptions(client.subscriptions);
                  subs.forEach(sub => {
                      const sName = sub.split('|')[0].trim().toLowerCase();
                      // Find creds for this service
                      const serviceCreds = credentials
                          .filter(c => c.isVisible && c.service.toLowerCase().includes(sName))
                          .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
                      
                      if (serviceCreds.length > 0) {
                          // Get Rank
                          const clientsForService = activeClients
                              .filter(c => normalizeSubscriptions(c.subscriptions).some(s => s.toLowerCase().includes(sName)))
                              .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
                          
                          const rank = clientsForService.findIndex(c => c.id === client.id);
                          if (rank !== -1) {
                              const credIndex = rank % serviceCreds.length;
                              const assigned = serviceCreds[credIndex];
                              if (assigned) usage[assigned.id] = (usage[assigned.id] || 0) + 1;
                          }
                      }
                  });
              });
              setCredentialUsage(usage);
          }
      }
      calculateUsage();
  }, [clients, credentials]);

  const loadData = async () => {
    setLoading(true);
    try {
        const [creds, allClients] = await Promise.all([fetchCredentials(), getAllClients()]);
        setCredentials(creds.filter(c => c.service !== 'SYSTEM_CONFIG'));
        setClients(allClients);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // --- ACTIONS ---

  const handleWhatsApp = (client: ClientDBRow) => {
      const subs = normalizeSubscriptions(client.subscriptions);
      const expiredServices: string[] = [];
      const expiringServices: string[] = [];

      subs.forEach(s => {
          const [name, dateStr] = s.split('|');
          const date = dateStr ? new Date(dateStr) : new Date(client.purchase_date);
          const exp = calculateExpiry(date.toISOString(), client.duration_months);
          const days = getDaysRemaining(exp);

          if (days < 0) expiredServices.push(name);
          else if (days <= 5) expiringServices.push(name);
      });

      let msg = `Olá ${client.client_name || 'Dorameira'}! Tudo bem? Passando para falar sobre sua assinatura da EuDorama.`;
      
      if (expiredServices.length > 0) {
          const list = expiredServices.join(', ');
          msg = `Olá ${client.client_name || ''}! Notamos que o acesso ao **${list}** venceu. 😢\n\nGostaria de renovar para continuar assistindo sem interrupções?`;
      } else if (expiringServices.length > 0) {
          const list = expiringServices.join(', ');
          msg = `Oie ${client.client_name || ''}! ✨\nPassando para lembrar que seu **${list}** vence em breve (menos de 5 dias).\n\nVamos garantir a renovação?`;
      }

      window.open(`https://wa.me/55${client.phone_number}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleSaveCredential = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!credForm.email || !credForm.password) return;
      await saveCredential(credForm as AppCredential);
      setCredForm({ service: SERVICES[0], email: '', password: '', isVisible: true, publishedAt: new Date().toISOString() });
      loadData();
  };

  const handleBulkImport = async () => {
      if (!bulkText.trim()) return alert("Cole os dados primeiro.");
      const lines = bulkText.split('\n');
      let count = 0;
      setLoading(true);
      for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split(/[,|\s]+/).filter(Boolean);
          if (parts.length >= 2) {
              const email = parts[0].trim();
              const password = parts[1].trim();
              
              // Use user selected date OR parsed date from line, fallback to now
              let date = new Date(bulkDate + "T12:00:00").toISOString();
              if (parts.length >= 3) {
                  const datePart = parts[2].trim();
                  const d = new Date(datePart);
                  if (!isNaN(d.getTime())) date = d.toISOString();
              }
              
              await saveCredential({ id: '', service: bulkService, email, password, publishedAt: date, isVisible: true });
              count++;
          }
      }
      setLoading(false);
      setBulkText('');
      setShowBulkImport(false);
      alert(`${count} contas importadas para ${bulkService}!`);
      loadData();
  };

  const handleDeleteCredential = (id: string) => {
      setConfirmDialog({
          title: 'Excluir Conta?', message: 'Acesso será removido.', confirmLabel: 'Excluir',
          onConfirm: async () => {
              setLoading(true); await deleteCredential(id); setLoading(false);
              setCredentials(prev => prev.filter(c => c.id !== id)); setConfirmDialog(null);
          }
      });
  };

  const handleClientAction = async (action: 'delete' | 'restore' | 'permanent', id: string) => {
      if (processingAction) return;
      
      if (action === 'delete') { 
          setConfirmDialog({ title: 'Mover para Lixeira?', message: 'O cliente perderá o acesso imediatamente.', confirmLabel: 'Mover',
              onConfirm: async () => {
                  setProcessingAction(true); await deleteClientFromDB(id); setClients(prev => prev.map(c => c.id === id ? { ...c, deleted: true } : c)); setProcessingAction(false); setConfirmDialog(null);
              }
          }); return;
      }
      
      if (action === 'permanent') {
           setConfirmDialog({ title: 'Excluir DEFINITIVAMENTE?', message: 'Isso apaga todo o histórico e não pode ser desfeito.', confirmLabel: 'EXCLUIR', requiresInput: true, inputPlaceholder: 'Código de Segurança Mestre', validationValue: '1202',
              onConfirm: async () => {
                  setProcessingAction(true); await permanentlyDeleteClient(id); setClients(prev => prev.filter(c => c.id !== id)); setProcessingAction(false); setConfirmDialog(null);
              }
          }); return;
      }

      setProcessingAction(true); await restoreClient(id); setClients(prev => prev.map(c => c.id === id ? { ...c, deleted: false } : c)); setProcessingAction(false);
  };

  const handleDangerAction = async (type: 'reset_general' | 'wipe') => {
      if (processingAction) return;
      setConfirmInput('');
      
      const requiresCode = true;
      const code = '1202';

      if (type === 'reset_general') {
          setConfirmDialog({ title: 'Resetar Geral?', message: 'Remove senhas e nomes de TODOS os clientes.', confirmLabel: 'RESETAR TUDO', requiresInput: true, inputPlaceholder: 'Código de Segurança Mestre', validationValue: code,
              onConfirm: async () => { setProcessingAction(true); await resetAllClientPasswords(); await resetAllNamesAndFixDates(); await loadData(); setProcessingAction(false); setConfirmDialog(null); }
          }); return;
      }
      if (type === 'wipe') {
          setConfirmDialog({ title: 'APAGAR BANCO DE DADOS?', message: 'AÇÃO DESTRUTIVA. APAGA TUDO.', confirmLabel: 'DESTRUIR TUDO', requiresInput: true, inputPlaceholder: 'Código de Segurança Mestre', validationValue: code,
              onConfirm: async () => { setProcessingAction(true); await hardDeleteAllClients(); await loadData(); setProcessingAction(false); setConfirmDialog(null); }
          }); return;
      }
  };

  // --- MODAL CLIENTE ---
  const handleOpenClientModal = (client?: ClientDBRow) => {
      if (client) setClientForm(client);
      else setClientForm({ phone_number: '', client_name: '', client_password: '', subscriptions: [], duration_months: 1, is_debtor: false, is_contacted: false, purchase_date: toLocalInput(new Date().toISOString()), manual_credentials: {} });
      setClientModalOpen(true);
  };

  const handleAddSubInModal = () => {
      const fullDate = new Date(`${newSubDate}T12:00:00`).toISOString();
      const newSubString = `${newSubService}|${fullDate}`;
      const currentSubs = normalizeSubscriptions(clientForm.subscriptions || []);
      setClientForm({ ...clientForm, subscriptions: [...currentSubs.filter(s => !s.startsWith(newSubService)), newSubString] });
  };

  const handleRemoveSubInModal = (subString: string) => {
      setClientForm({ ...clientForm, subscriptions: normalizeSubscriptions(clientForm.subscriptions || []).filter(s => s !== subString) });
  };

  const handleSaveClient = async () => {
      if (!clientForm.phone_number) return alert("Telefone obrigatório");
      setSavingClient(true);
      await saveClientToDB(clientForm);
      setSavingClient(false);
      setClientModalOpen(false);
      loadData();
  };

  // --- BUSCAR LOGIN REVERSO (OPTIMIZED) ---
  const handleReverseSearch = (client: ClientDBRow) => {
      // Instant in-memory calculation, no network calls
      const accounts: {service: string, email: string, password: string, isBlocked: boolean, expiryDate: Date}[] = [];
      const subs = normalizeSubscriptions(client.subscriptions);
      
      const activeClients = clients.filter(c => !c.deleted);

      subs.forEach(sub => {
          const parts = sub.split('|');
          const sName = parts[0].trim().toLowerCase();
          const subDate = parts[1] ? parts[1] : client.purchase_date;
          
          // Calculate expiry info
          const purchaseDate = new Date(subDate);
          const expiry = new Date(purchaseDate);
          expiry.setMonth(purchaseDate.getMonth() + client.duration_months);
          const daysLeft = getDaysRemaining(expiry);
          
          // Logic from Dashboard: Blocked if is_debtor OR (expired and out of grace period)
          const isGracePeriod = daysLeft < 0 && daysLeft >= -3;
          const isBlocked = client.is_debtor || (daysLeft < 0 && !isGracePeriod && !client.override_expiration);

          // 1. Get all creds for this service
          const serviceCreds = credentials
              .filter(c => c.isVisible && c.service.toLowerCase().includes(sName))
              .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
          
          if (serviceCreds.length > 0) {
              // 2. Get all clients for this service sorted
              const clientsForService = activeClients
                  .filter(c => normalizeSubscriptions(c.subscriptions).some(s => s.toLowerCase().includes(sName)))
                  .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
              
              // 3. Find Rank
              const myRank = clientsForService.findIndex(c => c.id === client.id);
              
              if (myRank !== -1) {
                  const credIndex = myRank % serviceCreds.length;
                  const assignedCred = serviceCreds[credIndex];
                  if (assignedCred) {
                      accounts.push({
                          service: sName,
                          email: assignedCred.email,
                          password: assignedCred.password,
                          isBlocked: isBlocked,
                          expiryDate: expiry
                      });
                  }
              }
          }
      });

      setSearchedClientData({ client, accounts });
  };

  // --- FINANCEIRO INTELIGENTE ---
  const financialProjection = useMemo(() => {
      let totalMonthlyRevenue = 0;
      let activeClientsCount = 0;
      const breakdown: Record<string, {gain: number, loss: number, current: number}> = {};

      Object.keys(PRICES).forEach(k => {
          if(k !== 'default') breakdown[k] = {gain: 0, loss: 0, current: 0};
      });
      breakdown['outros'] = {gain: 0, loss: 0, current: 0};

      const now = new Date();
      const pastDate = new Date();
      pastDate.setDate(now.getDate() - analysisDays);

      let gainedRevenue = 0;
      let lostRevenue = 0;

      clients.forEach(c => {
          const subs = normalizeSubscriptions(c.subscriptions);
          let hasActive = false;
          const created = new Date(c.created_at);
          const isNew = created >= pastDate;

          subs.forEach(s => {
              const name = s.split('|')[0].trim().toLowerCase();
              let priceKey = 'outros';
              let price = PRICES['default'];

              for (const key of Object.keys(PRICES)) {
                  if (name.includes(key) && key !== 'default') {
                      priceKey = key;
                      price = PRICES[key];
                      break;
                  }
              }

              const dateStr = s.split('|')[1] || c.purchase_date;
              const exp = calculateExpiry(dateStr, c.duration_months);
              
              if (!c.deleted && getDaysRemaining(exp) >= 0) {
                  totalMonthlyRevenue += price;
                  breakdown[priceKey].current += price;
                  hasActive = true;

                  if (isNew) {
                      gainedRevenue += price;
                      breakdown[priceKey].gain += price;
                  }
              }
          });

          if (hasActive && !c.deleted) activeClientsCount++;
      });

      // Override losses to 0 as per user request
      lostRevenue = 0;
      Object.keys(breakdown).forEach(k => breakdown[k].loss = 0);

      const netGain = gainedRevenue - lostRevenue;
      const dailyVelocity = netGain / (analysisDays || 1);
      const projectedExtra = dailyVelocity * projectionDays;
      const projectedTotal = totalMonthlyRevenue + projectedExtra;

      return { totalMonthlyRevenue, activeClientsCount, gainedRevenue, lostRevenue, projectedTotal, netGain, breakdown };
  }, [clients, analysisDays, projectionDays]);

  const filteredClients = useMemo(() => {
    let list = clients;
    if (clientFilterStatus === 'trash') list = list.filter(c => c.deleted);
    else list = list.filter(c => !c.deleted);
    if (clientFilterStatus === 'debtor') list = list.filter(c => c.is_debtor);
    if (clientFilterStatus === 'active') {
         list = list.filter(c => {
            return normalizeSubscriptions(c.subscriptions).some(s => {
                const date = s.split('|')[1] || c.purchase_date;
                return getDaysRemaining(calculateExpiry(date, c.duration_months)) > 5;
            });
        });
    }
    if (clientFilterStatus === 'expiring') {
        list = list.filter(c => {
            return normalizeSubscriptions(c.subscriptions).some(s => {
                const date = s.split('|')[1] || c.purchase_date;
                const days = getDaysRemaining(calculateExpiry(date, c.duration_months));
                return days <= 5;
            });
        });
    }
    if (clientSearch) {
        const lower = clientSearch.toLowerCase();
        list = list.filter(c => c.phone_number.includes(lower) || c.client_name?.toLowerCase().includes(lower));
    }
    return list;
  }, [clients, clientSearch, clientFilterStatus]);

  // COLOR THEME STRATEGY: 
  // Light Mode: Indigo/Blue/Slate Palette (Colorful & Light) - NOW DEFAULT
  // Dark Mode: Slate/Gray/White (High Contrast) - NOW ACTIVATED BY CLASS
  const wrapperClass = darkMode ? "dark bg-slate-950 text-slate-100" : "bg-indigo-50/30 text-indigo-950";

  return (
    <div className={`min-h-screen font-sans pb-10 transition-colors duration-300 ${wrapperClass}`}>
      
      {/* HEADER */}
      <div className="bg-white dark:bg-slate-900 px-6 py-5 flex justify-between items-center shadow-sm sticky top-0 z-30 mb-6 border-b border-indigo-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
              <div className="bg-gradient-to-tr from-indigo-600 to-blue-600 p-2.5 rounded-2xl text-white shadow-lg shadow-indigo-200 dark:shadow-none">
                  <ShieldAlert className="w-7 h-7" />
              </div>
              <div>
                  <h1 className="font-black text-2xl leading-none text-indigo-950 dark:text-white tracking-tight">Painel Admin</h1>
                  <p className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase tracking-widest mt-1">Gestão Pro</p>
              </div>
          </div>
          <div className="flex items-center gap-3">
              <button onClick={() => setDarkMode(!darkMode)} className="p-3 rounded-full bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-yellow-400 transition-colors hover:bg-indigo-100 dark:hover:bg-slate-700">
                  {darkMode ? <Sun className="w-6 h-6"/> : <Moon className="w-6 h-6"/>}
              </button>
              <button onClick={onLogout} className="flex items-center gap-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-5 py-3 rounded-2xl font-bold text-sm transition-colors border border-red-100 dark:border-red-900/50">
                  <LogOut className="w-5 h-5" /> Sair
              </button>
          </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 space-y-8">
          
          {/* NAVIGATION PILLS */}
          <div className="flex bg-white dark:bg-slate-900 p-1.5 rounded-full shadow-sm border border-indigo-100 dark:border-slate-800 overflow-x-auto scrollbar-hide">
              {[
                  {id: 'clients', icon: Users, label: 'Clientes'},
                  {id: 'credentials', icon: Key, label: 'Contas'},
                  {id: 'finance', icon: DollarSign, label: 'Financeiro'},
                  {id: 'search_client', icon: Search, label: 'Buscar Login'},
                  {id: 'danger', icon: AlertTriangle, label: 'Perigo'}
              ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)} 
                    className={`flex-1 py-3 px-6 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' : 'text-indigo-400 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-800'}`}
                  >
                      <tab.icon className="w-5 h-5" /> {tab.label}
                  </button>
              ))}
          </div>

          {activeTab === 'clients' && (
              <div className="space-y-6 animate-fade-in">
                  
                  {/* SEARCH & FILTERS */}
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center gap-3 bg-indigo-50 dark:bg-slate-800 px-5 py-4 rounded-3xl border border-indigo-100 dark:border-slate-700 focus-within:border-indigo-500 transition-colors">
                          <Search className="w-6 h-6 text-indigo-400 dark:text-slate-400" />
                          <input 
                              className="bg-transparent outline-none text-base font-bold text-indigo-900 dark:text-white w-full placeholder-indigo-300 dark:placeholder-slate-500" 
                              placeholder="Buscar nome ou telefone..." 
                              value={clientSearch} 
                              onChange={e => setClientSearch(e.target.value)} 
                          />
                      </div>
                      
                      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                          {[
                              {id: 'all', label: 'Todos', color: 'bg-indigo-600 text-white dark:bg-white dark:text-slate-900'},
                              {id: 'active', label: 'Em Dia', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'},
                              {id: 'expiring', label: 'Vencendo', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'},
                              {id: 'debtor', label: 'Devedores', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'},
                              {id: 'trash', label: 'Lixeira', color: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}
                          ].map(f => (
                              <button key={f.id} onClick={() => setClientFilterStatus(f.id as any)} className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wide border transition-all ${clientFilterStatus === f.id ? f.color : 'bg-white dark:bg-slate-900 text-indigo-300 dark:text-slate-500 border-indigo-100 dark:border-slate-800'}`}>{f.label}</button>
                          ))}
                      </div>

                      <div className="flex gap-2 justify-end pt-2 border-t border-indigo-100 dark:border-slate-800">
                          <button onClick={() => handleOpenClientModal()} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-3 rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none flex items-center gap-2 text-sm transition-transform active:scale-95">
                              <Plus className="w-6 h-6"/> Novo Cliente
                          </button>
                      </div>
                  </div>

                  {/* CLIENT LIST */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pb-24">
                      {filteredClients.map(client => (
                          <div key={client.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-sm border border-indigo-50 dark:border-slate-800 relative group overflow-hidden hover:shadow-xl transition-all hover:border-indigo-200 dark:hover:border-slate-600">
                              <div className="flex justify-between items-start mb-5">
                                  <div>
                                      <h3 className="font-extrabold text-gray-900 dark:text-white text-xl">{client.client_name || 'Sem Nome'}</h3>
                                      <p className="text-xs font-bold text-gray-500 dark:text-slate-400 flex items-center gap-1.5 mt-1"><Phone className="w-4 h-4"/> {client.phone_number}</p>
                                  </div>
                                  <div className="flex gap-2">
                                      <button onClick={() => handleWhatsApp(client)} className="w-11 h-11 rounded-full bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 flex items-center justify-center hover:bg-green-500 hover:text-white transition-all shadow-sm"><MessageCircle className="w-5 h-5" /></button>
                                      <button onClick={() => handleOpenClientModal(client)} className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all shadow-sm"><Edit2 className="w-5 h-5" /></button>
                                  </div>
                              </div>

                              <div className="flex flex-wrap gap-2 mb-6">
                                  {normalizeSubscriptions(client.subscriptions).map((sub, i) => {
                                      const [name, dateStr] = sub.split('|');
                                      const date = dateStr ? new Date(dateStr) : new Date(client.purchase_date);
                                      const days = getDaysRemaining(calculateExpiry(date.toISOString(), client.duration_months));
                                      const isExpiring = days <= 5;
                                      
                                      return (
                                          <div key={i} className={`flex items-center px-3 py-1.5 rounded-xl text-xs font-bold border ${isExpiring ? 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-900' : 'bg-green-50 text-green-700 border-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-900'}`}>
                                              {name} <span className="ml-1 opacity-70">({days}d)</span>
                                          </div>
                                      )
                                  })}
                              </div>

                              {client.deleted ? (
                                  <button onClick={() => handleClientAction('restore', client.id)} className="w-full py-4 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-indigo-400 dark:text-slate-400 font-bold text-xs hover:bg-indigo-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2">
                                      <RefreshCw className="w-5 h-5"/> Restaurar Cliente
                                  </button>
                              ) : (
                                  <button onClick={() => handleClientAction('delete', client.id)} className="w-full py-4 rounded-2xl border border-red-100 dark:border-red-900/50 text-red-400 dark:text-red-400 font-bold text-xs hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2">
                                      <Trash2 className="w-5 h-5"/> Mover para Lixeira
                                  </button>
                              )}
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {/* ... (OTHER TABS - NO MAJOR CHANGES) ... */}
          {activeTab === 'finance' && (
              <div className="space-y-8 animate-fade-in pb-24">
                  {/* Main Stats Card */}
                  <div className="bg-gradient-to-br from-green-500 via-emerald-500 to-teal-600 text-white p-8 rounded-[3rem] shadow-2xl shadow-green-200 dark:shadow-none relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
                      <div className="relative z-10">
                          <p className="text-green-100 font-bold text-sm uppercase tracking-widest mb-2 flex items-center gap-2"><DollarSign className="w-5 h-5"/> Receita Mensal Estimada</p>
                          <h2 className="text-6xl font-black tracking-tighter">R$ {financialProjection.totalMonthlyRevenue.toFixed(2).replace('.', ',')}</h2>
                          <div className="flex gap-4 mt-8">
                              <div className="bg-white/20 px-5 py-3 rounded-2xl backdrop-blur-md border border-white/10">
                                  <p className="text-[10px] font-bold text-green-50 uppercase opacity-90 mb-1">Clientes Ativos</p>
                                  <p className="font-bold text-2xl leading-none">{financialProjection.activeClientsCount}</p>
                              </div>
                          </div>
                      </div>
                  </div>

                  {/* Financial Breakdown Grid */}
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-sm border border-indigo-100 dark:border-slate-800">
                      <h3 className="font-black text-indigo-950 dark:text-white text-xl mb-6 flex items-center gap-2">
                          <Wallet className="w-6 h-6 text-indigo-500"/> Detalhamento por Serviço
                      </h3>
                      
                      <div className="space-y-4">
                          {/* Header Row */}
                          <div className="grid grid-cols-4 gap-4 px-4 pb-2 text-[10px] font-black text-indigo-300 dark:text-slate-500 uppercase tracking-widest border-b border-indigo-50 dark:border-slate-800">
                              <div className="col-span-1">App</div>
                              <div className="text-center">Vendas</div>
                              <div className="text-center">Perdas</div>
                              <div className="text-right">Total Ativo</div>
                          </div>

                          {Object.entries(financialProjection.breakdown).map(([key, data]: [string, {gain: number, loss: number, current: number}]) => {
                              if (data.current === 0 && data.loss === 0) return null;
                              return (
                                  <div key={key} className="grid grid-cols-4 gap-4 items-center bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl">
                                      <div className="col-span-1 font-bold capitalize text-indigo-900 dark:text-white text-sm">{key}</div>
                                      <div className="text-center">
                                          {data.gain > 0 ? (
                                              <span className="text-green-600 dark:text-green-400 font-bold text-sm bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-lg flex items-center justify-center gap-1">
                                                  <ArrowUpRight className="w-3 h-3"/> {data.gain}
                                              </span>
                                          ) : <span className="text-indigo-300 dark:text-slate-600">-</span>}
                                      </div>
                                      <div className="text-center">
                                          {data.loss > 0 ? (
                                              <span className="text-red-500 dark:text-red-400 font-bold text-sm bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded-lg flex items-center justify-center gap-1">
                                                  <ArrowDownRight className="w-3 h-3"/> {data.loss}
                                              </span>
                                          ) : <span className="text-indigo-300 dark:text-slate-600">-</span>}
                                      </div>
                                      <div className="text-right font-black text-lg text-indigo-950 dark:text-white">
                                          R$ {data.current.toFixed(0)}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>

                  {/* Projection Simulator */}
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-sm border border-indigo-100 dark:border-slate-800">
                      <h3 className="font-black text-indigo-950 dark:text-white text-xl mb-6 flex items-center gap-2">
                          <TrendingUp className="w-6 h-6 text-blue-500"/> Simulador de Futuro
                      </h3>
                      
                      <div className="flex gap-4 mb-8">
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase mb-2 block ml-1">Base (Dias)</label>
                              <select className="w-full bg-indigo-50 dark:bg-slate-800 rounded-2xl p-4 text-sm font-bold text-indigo-900 dark:text-white outline-none border border-transparent focus:border-indigo-500 transition-colors" value={analysisDays} onChange={e => setAnalysisDays(parseInt(e.target.value))}>
                                  <option value={7}>Últimos 7 dias</option>
                                  <option value={15}>Últimos 15 dias</option>
                                  <option value={30}>Últimos 30 dias</option>
                              </select>
                          </div>
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase mb-2 block ml-1">Projeção (Dias)</label>
                              <select className="w-full bg-indigo-50 dark:bg-slate-800 rounded-2xl p-4 text-sm font-bold text-indigo-900 dark:text-white outline-none border border-transparent focus:border-indigo-500 transition-colors" value={projectionDays} onChange={e => setProjectionDays(parseInt(e.target.value))}>
                                  <option value={15}>Daqui 15 dias</option>
                                  <option value={30}>Daqui 30 dias</option>
                                  <option value={60}>Daqui 60 dias</option>
                              </select>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-8">
                          <div className="bg-green-50 dark:bg-green-900/20 p-5 rounded-3xl border border-green-100 dark:border-green-900/50">
                              <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Ganho Recente</p>
                              <p className="text-2xl font-black text-green-700 dark:text-green-400 tracking-tight">+ R$ {financialProjection.gainedRevenue}</p>
                          </div>
                          <div className="bg-red-50 dark:bg-red-900/20 p-5 rounded-3xl border border-red-100 dark:border-red-900/50">
                              <p className="text-[10px] font-bold text-red-600 uppercase mb-1">Perda Recente</p>
                              <p className="text-2xl font-black text-red-700 dark:text-red-400 tracking-tight">- R$ {financialProjection.lostRevenue}</p>
                          </div>
                      </div>

                      <div className="border-t border-indigo-50 dark:border-slate-800 pt-6 text-center">
                          <p className="text-xs text-indigo-400 dark:text-slate-400 font-bold uppercase mb-3">Se continuar nesse ritmo, você terá:</p>
                          <div className={`text-5xl font-black tracking-tighter ${financialProjection.netGain >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-500'}`}>
                              R$ {financialProjection.projectedTotal.toFixed(2).replace('.', ',')}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'search_client' && (
              <div className="animate-fade-in flex flex-col items-center max-w-lg mx-auto space-y-8 pb-24">
                  <div className="bg-white dark:bg-slate-900 w-full p-8 rounded-[3rem] shadow-lg border border-indigo-100 dark:border-slate-800 text-center">
                      <div className="bg-indigo-100 dark:bg-slate-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-600 dark:text-indigo-400">
                          <Search className="w-10 h-10"/>
                      </div>
                      <h2 className="text-3xl font-black text-indigo-950 dark:text-white mb-3">Buscar Cliente</h2>
                      <p className="text-indigo-400 dark:text-slate-400 mb-8 text-sm font-medium">Digite o número ou nome para ver todos os logins e senhas que ele está usando.</p>
                      
                      <div className="relative">
                          <input 
                              className="w-full bg-indigo-50 dark:bg-slate-800 border-2 border-indigo-100 dark:border-slate-700 rounded-3xl px-6 py-5 font-bold text-lg text-indigo-900 dark:text-white outline-none focus:border-indigo-500 transition-colors text-center"
                              placeholder="Telefone ou Nome..."
                              value={searchClientTerm}
                              onChange={e => setSearchClientTerm(e.target.value)}
                          />
                      </div>
                  </div>

                  {searchClientTerm && (
                      <div className="w-full space-y-4">
                          {clients.filter(c => 
                              (c.phone_number.includes(searchClientTerm) || c.client_name?.toLowerCase().includes(searchClientTerm.toLowerCase())) && !c.deleted
                          ).map(client => (
                              <button key={client.id} onClick={() => handleReverseSearch(client)} className="w-full bg-white dark:bg-slate-900 p-5 rounded-3xl shadow-sm flex items-center justify-between group hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-indigo-200 dark:hover:border-slate-600">
                                  <div className="text-left">
                                      <p className="font-bold text-lg text-indigo-900 dark:text-white">{client.client_name || 'Sem Nome'}</p>
                                      <p className="text-xs font-mono text-indigo-400 dark:text-slate-400">{client.phone_number}</p>
                                  </div>
                                  <div className="bg-indigo-100 dark:bg-slate-700 text-indigo-600 dark:text-white p-3 rounded-full">
                                      <ChevronDown className="w-6 h-6 -rotate-90"/>
                                  </div>
                              </button>
                          ))}
                      </div>
                  )}
              </div>
          )}

          {activeTab === 'credentials' && (
              <div className="space-y-8 animate-fade-in pb-24">
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-sm border border-indigo-100 dark:border-slate-800">
                      <div className="flex justify-between items-center mb-6">
                          <h3 className="font-bold text-xl text-indigo-950 dark:text-white flex items-center gap-3"><Plus className="w-7 h-7 text-indigo-500"/> Nova Credencial</h3>
                          <button onClick={() => setShowBulkImport(!showBulkImport)} className="text-xs font-bold text-white bg-indigo-600 px-5 py-3 rounded-xl flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all active:scale-95"><FileUp className="w-5 h-5"/> IMPORTAR EM MASSA</button>
                      </div>

                      {showBulkImport && (
                          <div className="bg-indigo-50 dark:bg-slate-800 p-6 rounded-3xl mb-8 border border-indigo-100 dark:border-slate-700 animate-slide-up">
                              <h4 className="text-sm font-black text-indigo-900 dark:text-white flex items-center gap-2 mb-4 uppercase tracking-wide"><FileUp className="w-5 h-5"/> Colar Dados (CSV)</h4>
                              <div className="mb-4 flex flex-wrap items-center gap-3">
                                  <select 
                                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-600 text-indigo-900 dark:text-white font-bold text-sm outline-none shadow-sm"
                                      value={bulkService}
                                      onChange={(e) => setBulkService(e.target.value)}
                                  >
                                      {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl border border-indigo-200 dark:border-slate-600 px-3 py-1 shadow-sm">
                                      <Calendar className="w-5 h-5 text-indigo-400 mr-2" />
                                      <input 
                                          type="date" 
                                          className="p-2 text-sm font-bold text-indigo-900 dark:text-white bg-transparent outline-none" 
                                          value={bulkDate}
                                          onChange={(e) => setBulkDate(e.target.value)}
                                      />
                                  </div>
                              </div>
                              <textarea className="w-full h-32 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-600 text-sm font-mono outline-none text-indigo-900 dark:text-white placeholder-indigo-300 dark:placeholder-slate-500 shadow-inner" placeholder="email@exemplo.com, senha123" value={bulkText} onChange={e => setBulkText(e.target.value)} />
                              <button onClick={handleBulkImport} className="mt-4 w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-sm shadow-md hover:bg-indigo-700 active:scale-95 transition-transform">PROCESSAR IMPORTAÇÃO</button>
                          </div>
                      )}

                      <form onSubmit={handleSaveCredential} className="space-y-4">
                          <select className="w-full p-5 bg-indigo-50 dark:bg-slate-800 rounded-2xl border border-indigo-100 dark:border-slate-700 text-base font-bold text-indigo-900 dark:text-white outline-none appearance-none" value={credForm.service} onChange={e => setCredForm({...credForm, service: e.target.value})}>
                              {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <input className="w-full p-5 bg-indigo-50 dark:bg-slate-800 rounded-2xl border border-indigo-100 dark:border-slate-700 text-base font-bold text-indigo-900 dark:text-white placeholder-indigo-300 dark:placeholder-slate-500 outline-none" placeholder="Email do serviço" value={credForm.email} onChange={e => setCredForm({...credForm, email: e.target.value})} />
                          <input className="w-full p-5 bg-indigo-50 dark:bg-slate-800 rounded-2xl border border-indigo-100 dark:border-slate-700 text-base font-bold text-indigo-900 dark:text-white placeholder-indigo-300 dark:placeholder-slate-500 outline-none" placeholder="Senha" value={credForm.password} onChange={e => setCredForm({...credForm, password: e.target.value})} />
                          <button type="submit" className="w-full bg-indigo-950 dark:bg-white dark:text-indigo-950 text-white font-bold py-5 rounded-2xl shadow-xl hover:scale-[1.01] transition-transform text-lg">SALVAR CONTA</button>
                      </form>
                  </div>

                  <div className="space-y-5">
                      {credentials.map(cred => {
                          const health = getCredentialHealth(cred.service, cred.publishedAt);
                          const count = credentialUsage[cred.id] || 0;
                          
                          // Determine limit based on service name
                          let limit = 5; // Default
                          const sName = cred.service.toLowerCase();
                          if (sName.includes('viki')) limit = LIMITS['viki'];
                          else if (sName.includes('kocowa')) limit = LIMITS['kocowa'];
                          else if (sName.includes('iqiyi')) limit = LIMITS['iqiyi'];
                          else if (sName.includes('wetv') || sName.includes('dramabox')) limit = 999;

                          const isOverloaded = count > limit;
                          
                          return (
                              <div key={cred.id} className={`bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-sm border ${isOverloaded ? 'border-red-300 dark:border-red-800 ring-2 ring-red-100 dark:ring-red-900/30' : 'border-indigo-50 dark:border-slate-800'} relative overflow-hidden group hover:shadow-lg transition-all`}>
                                  <div className="flex justify-between items-start mb-4">
                                      <span className="text-xs font-black text-indigo-300 dark:text-slate-500 uppercase tracking-widest">{cred.service}</span>
                                      <button onClick={() => handleDeleteCredential(cred.id)} className="text-indigo-200 hover:text-red-500 transition-colors"><Trash2 className="w-6 h-6"/></button>
                                  </div>
                                  <div className="flex justify-between items-center bg-indigo-50 dark:bg-slate-800 p-4 rounded-2xl mb-4 border border-indigo-100 dark:border-slate-700">
                                      <div>
                                          <p className="font-bold text-indigo-900 dark:text-white text-base break-all">{cred.email}</p>
                                          <p className="font-mono text-xs text-indigo-400 dark:text-slate-400 mt-1">{cred.password}</p>
                                      </div>
                                  </div>
                                  
                                  <div className="flex justify-between items-center">
                                      <div className={`px-4 py-2 rounded-xl flex items-center gap-2 text-xs font-bold border ${health.color}`}>
                                          {health.icon} {health.label}
                                      </div>
                                      <div className={`text-sm font-bold flex items-center gap-2 ${isOverloaded ? 'text-red-600 dark:text-red-400' : (count > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-indigo-300 dark:text-slate-500')}`}>
                                          <Users className="w-5 h-5"/> {count}/{limit === 999 ? '∞' : limit}
                                      </div>
                                  </div>
                                  {isOverloaded && (
                                      <p className="text-[10px] font-bold text-red-500 mt-3 text-center animate-pulse bg-red-50 dark:bg-red-900/20 py-2 rounded-lg">
                                          LIMITE EXCEDIDO! Crie nova conta urgentemente.
                                      </p>
                                  )}
                              </div>
                          )
                      })}
                  </div>
              </div>
          )}

          {activeTab === 'danger' && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-10 animate-fade-in pb-24">
                  <div className="bg-red-50 dark:bg-red-900/20 p-8 rounded-full animate-pulse shadow-lg shadow-red-100 dark:shadow-none">
                      <Shield className="w-16 h-16 text-red-500" />
                  </div>
                  <div className="text-center">
                      <h2 className="text-3xl font-black text-red-600 mb-3">Zona de Perigo</h2>
                      <p className="text-red-400 font-bold text-sm bg-red-50 dark:bg-red-900/30 px-4 py-2 rounded-full inline-block">Código de Segurança Mestre Necessário</p>
                  </div>
                  
                  <div className="w-full max-w-md space-y-5 px-4">
                      <button onClick={() => handleDangerAction('reset_general')} className="w-full bg-white dark:bg-slate-900 border-2 border-red-100 dark:border-red-900/50 text-red-500 font-bold py-5 rounded-3xl shadow-sm hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-lg">
                          Resetar Senhas Clientes
                      </button>
                      <button onClick={() => handleDangerAction('wipe')} className="w-full bg-red-600 text-white font-bold py-5 rounded-3xl shadow-xl shadow-red-200 dark:shadow-none hover:bg-red-700 transition-transform active:scale-95 text-lg">
                          DESTRUIR BANCO DE DADOS
                      </button>
                  </div>
              </div>
          )}

      </main>

      {/* CLIENT MODAL - APP STYLE */}
      {clientModalOpen && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative animate-slide-up max-h-[90vh] overflow-y-auto border-4 border-indigo-50 dark:border-slate-800">
                  
                  {/* Modal Header */}
                  <div className="flex justify-between items-center mb-8">
                      <div>
                          <h3 className="font-extrabold text-2xl text-indigo-950 dark:text-white leading-none">
                              {clientForm.id ? 'Editar Cliente' : 'Novo Cliente'}
                          </h3>
                      </div>
                      <button onClick={() => setClientModalOpen(false)} className="p-3 bg-indigo-50 dark:bg-slate-800 rounded-full hover:bg-indigo-100 transition-colors"><X className="w-6 h-6 text-indigo-400 dark:text-slate-400"/></button>
                  </div>

                  <div className="space-y-6">
                      {/* Name Input */}
                      <div className="bg-indigo-50 dark:bg-slate-800 p-5 rounded-3xl border border-transparent focus-within:border-indigo-500 transition-colors">
                          <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase block mb-1 ml-1">Nome do Cliente</label>
                          <input className="w-full bg-transparent text-xl font-bold text-indigo-900 dark:text-white outline-none" value={clientForm.client_name} onChange={e => setClientForm({...clientForm, client_name: e.target.value})} placeholder="Opcional" />
                      </div>

                      {/* Phone Input */}
                      <div className="bg-indigo-50 dark:bg-slate-800 p-5 rounded-3xl border border-transparent focus-within:border-indigo-500 transition-colors">
                          <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase block mb-1 ml-1">WhatsApp</label>
                          <input className="w-full bg-transparent text-xl font-bold text-indigo-900 dark:text-white outline-none" value={clientForm.phone_number} onChange={e => setClientForm({...clientForm, phone_number: e.target.value})} placeholder="11999999999" />
                      </div>

                      {/* Controls Row */}
                      <div className="flex gap-3">
                          {/* Plan Dropdown */}
                          <div className="flex-1 bg-indigo-50 dark:bg-slate-800 p-4 rounded-3xl flex flex-col justify-between">
                              <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase mb-1 ml-1">Plano</label>
                              <div className="relative">
                                  <select 
                                    className="w-full bg-white dark:bg-slate-700 text-indigo-900 dark:text-white font-bold text-sm p-3 rounded-2xl outline-none appearance-none shadow-sm"
                                    value={clientForm.duration_months}
                                    onChange={e => setClientForm({...clientForm, duration_months: parseInt(e.target.value)})}
                                  >
                                      <option value={1}>1 Mês</option>
                                      <option value={3}>3 Meses</option>
                                      <option value={6}>6 Meses</option>
                                      <option value={12}>1 Ano</option>
                                  </select>
                                  <ChevronDown className="w-4 h-4 absolute right-3 top-3.5 text-indigo-300 dark:text-slate-400 pointer-events-none"/>
                              </div>
                          </div>

                          {/* Toggles */}
                          <div className="flex-1 bg-indigo-50 dark:bg-slate-800 p-4 rounded-3xl flex flex-col items-center justify-center gap-2">
                              <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase">Bloqueado</label>
                              <div 
                                onClick={() => setClientForm({...clientForm, is_debtor: !clientForm.is_debtor})}
                                className={`w-12 h-7 rounded-full p-1 cursor-pointer transition-colors duration-300 ${clientForm.is_debtor ? 'bg-red-500' : 'bg-indigo-200 dark:bg-slate-600'}`}
                              >
                                  <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${clientForm.is_debtor ? 'translate-x-5' : ''}`}></div>
                              </div>
                          </div>
                          <div className="flex-1 bg-indigo-50 dark:bg-slate-800 p-4 rounded-3xl flex flex-col items-center justify-center gap-2">
                              <label className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 uppercase">Cobrado</label>
                              <div 
                                onClick={() => setClientForm({...clientForm, is_contacted: !clientForm.is_contacted})}
                                className={`w-12 h-7 rounded-full p-1 cursor-pointer transition-colors duration-300 ${clientForm.is_contacted ? 'bg-blue-500' : 'bg-indigo-200 dark:bg-slate-600'}`}
                              >
                                  <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${clientForm.is_contacted ? 'translate-x-5' : ''}`}></div>
                              </div>
                          </div>
                      </div>

                      {/* Add Subscription Section */}
                      <div className="pt-4">
                          <p className="text-xs font-bold text-indigo-400 dark:text-slate-400 uppercase mb-3 ml-2">Adicionar Assinatura</p>
                          <div className="flex gap-2">
                              <div className="flex-1 relative">
                                  <select 
                                    className="w-full bg-indigo-50 dark:bg-slate-800 text-indigo-900 dark:text-white font-bold text-sm p-4 rounded-2xl outline-none appearance-none border border-transparent focus:border-indigo-500 transition-colors"
                                    value={newSubService}
                                    onChange={e => setNewSubService(e.target.value)}
                                  >
                                      {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <ChevronDown className="w-5 h-5 absolute right-4 top-4 text-indigo-300 dark:text-slate-400 pointer-events-none"/>
                              </div>
                              <input 
                                type="date" 
                                className="w-36 bg-indigo-50 dark:bg-slate-800 text-indigo-900 dark:text-white font-bold text-sm p-4 rounded-2xl outline-none"
                                value={newSubDate}
                                onChange={e => setNewSubDate(e.target.value)}
                              />
                          </div>
                          <button onClick={handleAddSubInModal} className="w-full bg-indigo-950 dark:bg-white dark:text-indigo-950 text-white font-bold py-4 rounded-2xl text-sm shadow-xl mt-3 active:scale-95 transition-transform flex justify-center items-center gap-2">
                              <Plus className="w-5 h-5"/> Vincular Serviço
                          </button>
                      </div>

                      {/* Current Subscriptions List */}
                      {normalizeSubscriptions(clientForm.subscriptions || []).length > 0 && (
                          <div className="pt-2">
                              <p className="text-xs font-bold text-indigo-400 dark:text-slate-400 uppercase mb-3 ml-2 flex items-center gap-1"><Activity className="w-4 h-4"/> Assinaturas Ativas</p>
                              <div className="space-y-3">
                                  {normalizeSubscriptions(clientForm.subscriptions || []).map((sub, i) => {
                                      const [name, dateStr] = sub.split('|');
                                      const date = dateStr ? new Date(dateStr) : new Date();
                                      const days = getDaysRemaining(calculateExpiry(date.toISOString(), clientForm.duration_months || 1));
                                      
                                      return (
                                          <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-800 border-2 border-indigo-50 dark:border-slate-700 p-4 rounded-3xl shadow-sm">
                                              <div>
                                                  <p className="text-sm font-black text-indigo-900 dark:text-white">{name}</p>
                                                  <p className="text-[10px] font-bold text-indigo-400 dark:text-slate-400 mt-0.5">Vence em {days} dias</p>
                                              </div>
                                              <div className="flex gap-2">
                                                  <button className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-slate-700 flex items-center justify-center text-indigo-400 dark:text-slate-400 hover:text-green-500 hover:bg-green-50 transition-colors"><RefreshCw className="w-5 h-5"/></button>
                                                  <button onClick={() => handleRemoveSubInModal(sub)} className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors"><Trash2 className="w-5 h-5"/></button>
                                              </div>
                                          </div>
                                      )
                                  })}
                              </div>
                          </div>
                      )}

                      <button onClick={handleSaveClient} disabled={savingClient} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-3xl shadow-xl shadow-indigo-200 dark:shadow-none mt-6 hover:bg-indigo-700 active:scale-95 transition-all text-base flex justify-center items-center gap-2">
                          {savingClient ? <Loader2 className="w-6 h-6 animate-spin"/> : 'Salvar Alterações'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* REVERSE SEARCH RESULT MODAL */}
      {searchedClientData && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative animate-slide-up border-4 border-indigo-50 dark:border-slate-800">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="font-extrabold text-xl text-indigo-950 dark:text-white">Acessos do Cliente</h3>
                      <button onClick={() => setSearchedClientData(null)} className="p-3 bg-indigo-50 dark:bg-slate-800 rounded-full hover:bg-indigo-100 transition-colors"><X className="w-6 h-6 text-indigo-400 dark:text-slate-400"/></button>
                  </div>
                  
                  <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 p-5 rounded-3xl">
                      <p className="font-bold text-lg text-blue-900 dark:text-blue-300">{searchedClientData.client.client_name || 'Sem Nome'}</p>
                      <p className="font-mono text-sm text-blue-700 dark:text-blue-400 mt-1">{searchedClientData.client.phone_number}</p>
                  </div>

                  <div className="space-y-4 max-h-72 overflow-y-auto">
                      {searchedClientData.accounts.map((acc, idx) => (
                          <div key={idx} className={`p-5 rounded-3xl border ${acc.isBlocked ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900' : 'bg-indigo-50 border-indigo-100 dark:bg-slate-800 dark:border-slate-700'}`}>
                              <div className="flex justify-between items-center mb-3">
                                  <p className="text-xs font-black text-indigo-400 dark:text-slate-400 uppercase ml-1">{acc.service}</p>
                                  {acc.isBlocked && (
                                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-1 rounded-lg">
                                          <Ban className="w-3 h-3"/> BLOQUEADO
                                      </span>
                                  )}
                              </div>
                              
                              {acc.isBlocked && (
                                  <p className="text-xs text-red-500 font-bold mb-3 text-center">
                                      Venceu em: {acc.expiryDate.toLocaleDateString('pt-BR')}
                                  </p>
                              )}

                              <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl mb-2 flex justify-between items-center border border-indigo-100 dark:border-slate-700">
                                  <span className="text-sm font-bold text-indigo-900 dark:text-white break-all px-1">{acc.email}</span>
                                  <Copy className="w-5 h-5 text-indigo-300 hover:text-indigo-600 cursor-pointer transition-colors" onClick={() => copyToClipboard(acc.email, `e-${idx}`)}/>
                              </div>
                              <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl flex justify-between items-center border border-indigo-100 dark:border-slate-700">
                                  <span className="text-sm font-mono text-indigo-600 dark:text-slate-300 px-1">{acc.password}</span>
                                  <Copy className="w-5 h-5 text-indigo-300 hover:text-indigo-600 cursor-pointer transition-colors" onClick={() => copyToClipboard(acc.password, `p-${idx}`)}/>
                              </div>
                          </div>
                      ))}
                      {searchedClientData.accounts.length === 0 && (
                          <p className="text-center text-indigo-400 font-bold py-6">Nenhum login atribuído a este cliente.</p>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* CONFIRM DIALOG */}
      {confirmDialog && (
          <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 w-full max-w-sm shadow-2xl text-center border-4 border-red-100 dark:border-red-900/50">
                  <h3 className="text-2xl font-black text-indigo-950 dark:text-white mb-3">{confirmDialog.title}</h3>
                  <p className="text-indigo-500 dark:text-slate-400 text-sm mb-8 font-medium leading-relaxed">{confirmDialog.message}</p>
                  {confirmDialog.requiresInput && (
                      <input 
                        type="password" 
                        className="w-full bg-indigo-50 dark:bg-slate-800 border-2 border-red-100 dark:border-red-900 rounded-2xl p-4 text-center font-bold text-indigo-900 dark:text-white outline-none focus:border-red-400 placeholder-indigo-300 dark:placeholder-slate-600 mb-6 text-lg" 
                        placeholder={confirmDialog.inputPlaceholder} 
                        value={confirmInput} 
                        onChange={(e) => setConfirmInput(e.target.value)} 
                      />
                  )}
                  <div className="flex flex-col gap-4">
                      <button onClick={() => { if(confirmDialog.requiresInput && confirmInput !== confirmDialog.validationValue) return alert("Código incorreto!"); confirmDialog.onConfirm(); }} className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-5 rounded-2xl shadow-xl shadow-red-200 dark:shadow-none transition-transform active:scale-95 text-lg">{confirmDialog.confirmLabel}</button>
                      <button onClick={() => setConfirmDialog(null)} className="w-full bg-indigo-50 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-slate-700 text-indigo-600 dark:text-slate-300 font-bold py-4 rounded-2xl transition-colors">Cancelar</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};
