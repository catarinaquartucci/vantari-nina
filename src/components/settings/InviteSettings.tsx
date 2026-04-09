import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, Mail, Check, Clock, Loader2 } from 'lucide-react';
import { useCompanySettings } from '@/hooks/useCompanySettings';

interface InvitedEmail {
  id: string;
  email: string;
  used_at: string | null;
  created_at: string;
}

const InviteSettings: React.FC = () => {
  const [emails, setEmails] = useState<InvitedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const { isAdmin } = useCompanySettings();

  const fetchEmails = async () => {
    const { data, error } = await supabase
      .from('invited_emails')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setEmails(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const handleAdd = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      toast.error('Digite um email válido');
      return;
    }

    setAdding(true);
    const { error } = await supabase
      .from('invited_emails')
      .insert({ email: trimmed });

    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        toast.error('Este email já foi convidado');
      } else {
        toast.error('Erro ao adicionar convite');
      }
    } else {
      toast.success(`Convite adicionado para ${trimmed}`);
      setNewEmail('');
      fetchEmails();
    }
    setAdding(false);
  };

  const handleRemove = async (id: string, email: string) => {
    const { error } = await supabase
      .from('invited_emails')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Erro ao remover convite');
    } else {
      toast.success(`Convite removido para ${email}`);
      fetchEmails();
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-muted-foreground text-center py-8">
        Apenas administradores podem gerenciar convites.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">Convites de Acesso</h3>
        <p className="text-sm text-muted-foreground">
          Apenas pessoas com email convidado podem criar conta no sistema.
        </p>
      </div>

      {/* Add new invite */}
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-2">
          <Label className="text-foreground">Novo email</Label>
          <Input
            type="email"
            placeholder="email@exemplo.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
        </div>
        <Button
          variant="primary"
          onClick={handleAdd}
          disabled={adding || !newEmail.trim()}
          className="gap-2"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Convidar
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : emails.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          Nenhum convite cadastrado. Adicione emails para permitir novos cadastros.
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border"
            >
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-foreground text-sm">{inv.email}</span>
                {inv.used_at ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    <Check className="w-3 h-3" /> Usado
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    <Clock className="w-3 h-3" /> Pendente
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(inv.id, inv.email)}
                className="text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InviteSettings;
