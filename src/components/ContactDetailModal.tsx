import React, { useEffect, useState } from 'react';
import { X, Phone, Mail, FileText, Hash, Tag, Brain, MessageSquare, Loader2, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';

interface ContactDetailModalProps {
  contactId: string | null;
  onClose: () => void;
}

const ContactDetailModal: React.FC<ContactDetailModalProps> = ({ contactId, onClose }) => {
  const { sdrName } = useCompanySettings();
  const [contact, setContact] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);

    const loadData = async () => {
      // Fetch contact
      const { data: contactData } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();

      setContact(contactData);
      setLoading(false);

      // Fetch latest conversation messages
      setLoadingMessages(true);
      const { data: convData } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (convData) {
        const { data: msgData } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', convData.id)
          .order('sent_at', { ascending: false })
          .limit(20);

        setMessages((msgData || []).reverse());
      }
      setLoadingMessages(false);
    };

    loadData();
  }, [contactId]);

  if (!contactId) return null;

  const memory = contact?.client_memory;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 shadow-2xl z-50 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
          </div>
        ) : contact ? (
          <>
            {/* Header */}
            <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 p-6">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-700 flex items-center justify-center text-lg font-bold text-cyan-400">
                    {(contact.name || contact.phone_number || '?').substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{contact.name || contact.call_name || 'Sem nome'}</h2>
                    <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {contact.phone_number}</span>
                      {contact.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {contact.email}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* Info Cards */}
              <div className="p-6 space-y-3">
                {/* CPF */}
                {contact.cpf && (
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><FileText className="w-3 h-3" /> CPF</span>
                    <p className="text-sm text-slate-200 mt-1 font-mono font-medium">{contact.cpf}</p>
                  </div>
                )}

                {/* Número do Processo */}
                {contact.numero_processo && (
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Hash className="w-3 h-3" /> Nº do Processo Trabalhista</span>
                    <p className="text-sm text-slate-200 mt-1 font-mono font-medium">{contact.numero_processo}</p>
                  </div>
                )}

                {/* Status & Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400">Primeiro Contato</span>
                    <p className="text-sm text-slate-200 mt-1">{new Date(contact.first_contact_date).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400">Última Atividade</span>
                    <p className="text-sm text-slate-200 mt-1">{new Date(contact.last_activity).toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>

                {/* Tags */}
                {contact.tags && contact.tags.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {contact.tags.map((tag: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs rounded-md border border-cyan-500/20">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {contact.notes && (
                  <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                    <span className="text-xs text-slate-400">Notas</span>
                    <p className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">{contact.notes}</p>
                  </div>
                )}
              </div>

              {/* Nina Insights */}
              {memory && memory.lead_profile && (
                <div className="p-6 border-t border-slate-800">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-violet-500" /> Insights do(a) {sdrName}
                  </h4>
                  <div className="space-y-3">
                    {/* Score */}
                    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Score de Qualificação</span>
                        <span className="text-sm font-bold text-cyan-400">{memory.lead_profile.qualification_score || 0}%</span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div className="bg-gradient-to-r from-cyan-500 to-violet-500 h-1.5 rounded-full" style={{ width: `${memory.lead_profile.qualification_score || 0}%` }} />
                      </div>
                    </div>

                    {memory.lead_profile.interests?.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                        <span className="text-xs text-slate-400">Interesses</span>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {memory.lead_profile.interests.map((i: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md border border-emerald-500/20">{i}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {memory.sales_intelligence?.pain_points?.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                        <span className="text-xs text-slate-400">Dores Identificadas</span>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {memory.sales_intelligence.pain_points.map((p: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded-md border border-red-500/20">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="p-6 border-t border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-cyan-500" /> Histórico de Mensagens ({messages.length})
                </h4>

                {loadingMessages ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-cyan-500" /></div>
                ) : messages.length === 0 ? (
                  <p className="text-center py-4 text-slate-500 text-sm">Nenhuma mensagem encontrada</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                    {messages.map(msg => (
                      <div
                        key={msg.id}
                        className={`p-2 rounded-lg text-sm ${
                          msg.from_type === 'user'
                            ? 'bg-slate-800 text-slate-200 ml-0 mr-8'
                            : msg.from_type === 'nina'
                              ? 'bg-cyan-900/30 text-cyan-100 ml-8 mr-0'
                              : 'bg-emerald-900/30 text-emerald-100 ml-8 mr-0'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
                          <span className="font-medium">
                            {msg.from_type === 'user' ? '👤 Lead' : msg.from_type === 'nina' ? `🤖 ${sdrName}` : '👨‍💼 Humano'}
                          </span>
                          <span>•</span>
                          <span>{new Date(msg.sent_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="leading-relaxed line-clamp-3">{msg.content || '[mídia]'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <p>Contato não encontrado</p>
          </div>
        )}
      </div>
    </>
  );
};

export default ContactDetailModal;
