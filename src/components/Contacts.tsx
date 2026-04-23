import React, { useEffect, useMemo, useState } from 'react';
import { Search, Filter, MoreHorizontal, UserPlus, MessageSquare, Loader2, Mail, Phone, Users, FileText, IdCard, CheckCircle2, AlertCircle, Circle, RefreshCw, User, Bot } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { api } from '../services/api';
import { Contact } from '../types';
import ContactDetailModal from './ContactDetailModal';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type CompletenessFilter = 'all' | 'complete' | 'pending' | 'with_cpf' | 'with_processo';
type OwnerFilter = 'all' | 'mine' | 'unassigned' | 'assigned';

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [completenessFilter, setCompletenessFilter] = useState<CompletenessFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [backfilling, setBackfilling] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const { user } = useAuth();

  const loadContacts = async () => {
    try {
      const data = await api.fetchContacts();
      setContacts(data);
    } catch (error) {
      console.error("Erro ao carregar contatos", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        (c.name?.toLowerCase() || '').includes(term) ||
        (c.phone || '').includes(term) ||
        (c.email?.toLowerCase() || '').includes(term) ||
        (c.cpf || '').toLowerCase().includes(term) ||
        (c.numeroProcesso || '').toLowerCase().includes(term) ||
        (c.ownerName?.toLowerCase() || '').includes(term);

      if (!matchesSearch) return false;

      const hasCpf = !!c.cpf;
      const hasProcesso = !!c.numeroProcesso;

      const passesCompleteness = (() => {
        switch (completenessFilter) {
          case 'complete':
            return hasCpf && hasProcesso;
          case 'pending':
            return !hasCpf || !hasProcesso;
          case 'with_cpf':
            return hasCpf;
          case 'with_processo':
            return hasProcesso;
          default:
            return true;
        }
      })();
      if (!passesCompleteness) return false;

      switch (ownerFilter) {
        case 'mine':
          return !!user?.id && c.ownerUserId === user.id;
        case 'unassigned':
          return !c.ownerId;
        case 'assigned':
          return !!c.ownerId;
        default:
          return true;
      }
    });
  }, [contacts, searchTerm, completenessFilter, ownerFilter, user?.id]);

  const stats = useMemo(() => {
    const complete = contacts.filter((c) => c.cpf && c.numeroProcesso).length;
    const withCpf = contacts.filter((c) => c.cpf).length;
    const withProcesso = contacts.filter((c) => c.numeroProcesso).length;
    return { complete, withCpf, withProcesso, total: contacts.length };
  }, [contacts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'customer': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'lead': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'churned': return 'bg-slate-800 text-slate-400 border-slate-700';
      default: return 'bg-slate-800 text-slate-400';
    }
  };

  const getCompletenessIcon = (contact: Contact) => {
    const hasCpf = !!contact.cpf;
    const hasProcesso = !!contact.numeroProcesso;
    if (hasCpf && hasProcesso) {
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-label="Dados completos" />;
    }
    if (hasCpf || hasProcesso) {
      return <AlertCircle className="w-4 h-4 text-amber-400" aria-label="Dados parciais" />;
    }
    return <Circle className="w-4 h-4 text-slate-600" aria-label="Sem dados" />;
  };

  const handleStartConversation = (contact: Contact) => {
    navigate(`/chat?contact=${encodeURIComponent(contact.phone)}`);
  };

  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    const toastId = toast.loading('Reprocessando dados dos contatos... isso pode levar alguns minutos.');
    try {
      const { data, error } = await supabase.functions.invoke('backfill-contact-data');
      if (error) throw error;
      const cpfFound = data?.cpf_found ?? 0;
      const processoFound = data?.processo_found ?? 0;
      const processed = data?.processed ?? 0;
      toast.success(
        `Reprocessamento concluído: ${processed} contatos analisados, ${cpfFound} CPFs e ${processoFound} processos extraídos.`,
        { id: toastId, duration: 6000 }
      );
      await loadContacts();
    } catch (e) {
      console.error('[Backfill] Error:', e);
      toast.error('Erro ao reprocessar dados. Verifique os logs.', { id: toastId });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-950 text-slate-50">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Contatos</h2>
          <p className="text-sm text-slate-400 mt-1">
            Gerencie sua base de leads e clientes com inteligência.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              className="bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800"
              onClick={handleBackfill}
              disabled={backfilling}
              title="Reprocessar dados (extrai CPF e processo das conversas)"
            >
              {backfilling ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Reprocessar dados
            </Button>
          )}
          <Button
            className="shadow-lg shadow-cyan-500/20 opacity-50 cursor-not-allowed"
            disabled
            title="Em breve: Adicionar contato"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Novo Contato
          </Button>
        </div>
      </div>

      {/* Stats summary */}
      {!loading && contacts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Total</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.total}</div>
          </div>
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4">
            <div className="text-xs text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Completos
            </div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">
              {stats.complete}
              <span className="text-sm text-slate-500 font-normal">
                {' '}/ {stats.total}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <IdCard className="w-3 h-3" /> Com CPF
            </div>
            <div className="text-2xl font-bold text-white mt-1">{stats.withCpf}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <FileText className="w-3 h-3" /> Com Processo
            </div>
            <div className="text-2xl font-bold text-white mt-1">{stats.withProcesso}</div>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-4 mb-8 bg-slate-900/50 p-2 rounded-xl border border-slate-800">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por nome, email, telefone, CPF ou processo"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-slate-600 transition-all"
          />
        </div>
        <div className="w-full sm:w-56">
          <Select value={completenessFilter} onValueChange={(v) => setCompletenessFilter(v as CompletenessFilter)}>
            <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <SelectValue placeholder="Filtrar por dados" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os contatos</SelectItem>
              <SelectItem value="complete">Dados completos</SelectItem>
              <SelectItem value="pending">Dados pendentes</SelectItem>
              <SelectItem value="with_cpf">Com CPF</SelectItem>
              <SelectItem value="with_processo">Com Processo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select value={ownerFilter} onValueChange={(v) => setOwnerFilter(v as OwnerFilter)}>
            <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                <SelectValue placeholder="Responsável" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos responsáveis</SelectItem>
              <SelectItem value="mine">Atribuídos a mim</SelectItem>
              <SelectItem value="assigned">Com responsável</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-sm shadow-xl overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-80">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-500 mb-3" />
            <span className="text-sm text-slate-400 animate-pulse">Carregando base de dados...</span>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-slate-400">
            <Users className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Nenhum contato encontrado</p>
            <p className="text-sm text-slate-500 mt-1">
              {searchTerm || completenessFilter !== 'all'
                ? 'Tente ajustar a busca ou os filtros'
                : 'Os contatos aparecerão aqui'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-4 w-10"></th>
                  <th className="px-4 py-4">Nome / Telefone</th>
                  <th className="px-4 py-4">CPF</th>
                  <th className="px-4 py-4">Nº Processo</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Responsável</th>
                  <th className="px-4 py-4">Última Interação</th>
                  <th className="px-4 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => setSelectedContactId(contact.id)}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center">
                        {getCompletenessIcon(contact)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-cyan-400 shadow-inner shrink-0">
                          {(contact.name || contact.phone || '?').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors truncate">
                            {contact.name || 'Sem nome'}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {contact.phone}
                          </div>
                          {contact.email && (
                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                              <Mail className="w-3 h-3" />
                              <span className="truncate">{contact.email}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {contact.cpf ? (
                        <span className="font-mono text-xs text-slate-200 bg-slate-800/60 px-2 py-1 rounded border border-slate-700">
                          {contact.cpf}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {contact.numeroProcesso ? (
                        <span className="font-mono text-xs text-slate-200 bg-slate-800/60 px-2 py-1 rounded border border-slate-700">
                          {contact.numeroProcesso}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${getStatusColor(contact.status)}`}>
                        {contact.status === 'customer' ? 'Cliente' : contact.status === 'lead' ? 'Lead' : 'Churned'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-slate-400 text-xs">
                        {new Date(contact.lastContact).toLocaleDateString('pt-BR')}
                      </span>
                      <div className="text-[10px] text-slate-600">via WhatsApp</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                        <Button
                          size="sm"
                          variant="primary"
                          className="h-8 w-8 p-0 rounded-lg shadow-none"
                          title="Iniciar Conversa"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartConversation(contact);
                          }}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 rounded-lg text-slate-500 cursor-not-allowed opacity-50"
                          disabled
                          title="Em breve: Mais opções"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Contact Detail Modal */}
      <ContactDetailModal
        contactId={selectedContactId}
        onClose={() => setSelectedContactId(null)}
      />
    </div>
  );
};

export default Contacts;
