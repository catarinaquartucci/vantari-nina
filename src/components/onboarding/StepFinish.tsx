import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Circle, Rocket, Send, Loader2, AlertCircle, RefreshCw, XCircle, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/Button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OnboardingStep } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StepFinishProps {
  steps: OnboardingStep[];
  companyName: string;
  sdrName: string;
  onComplete: () => void;
}

interface ValidationResult {
  component: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
}

interface ValidationData {
  results: ValidationResult[];
  overallStatus: 'ok' | 'warning' | 'error';
  summary: { ok: number; total: number; percentage: number };
  message: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

const listItemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { 
    opacity: 1, 
    x: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

const componentLabels: Record<string, string> = {
  identity: 'Identidade',
  whatsapp: 'WhatsApp',
  agent_prompt: 'Agente IA',
  elevenlabs: 'ElevenLabs',
  business_hours: 'Horário Comercial',
  lovable_ai: 'IA Backend',
  pipeline: 'Pipeline de Vendas',
  profile: 'Perfil',
  nina_settings: 'Configurações Nina',
};

export const StepFinish: React.FC<StepFinishProps> = ({
  steps,
  companyName,
  sdrName,
  onComplete,
}) => {
  const [testPhone, setTestPhone] = useState('');
  const [validation, setValidation] = useState<ValidationData | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  
  const getDefaultTestMessage = () => {
    if (sdrName && companyName) {
      return `Olá! Aqui é ${sdrName} da ${companyName}. Este é um teste do sistema! 🚀`;
    } else if (sdrName) {
      return `Olá! Aqui é ${sdrName}. Este é um teste do sistema Nina! 🚀`;
    } else if (companyName) {
      return `Olá! Aqui é o assistente da ${companyName}. Este é um teste do sistema! 🚀`;
    }
    return 'Olá! Este é um teste do sistema Nina SDR! 🚀';
  };
  
  const [testMessage, setTestMessage] = useState(getDefaultTestMessage);
  const [isSending, setIsSending] = useState(false);
  
  useEffect(() => {
    setTestMessage(getDefaultTestMessage());
  }, [sdrName, companyName]);

  const runValidation = useCallback(async () => {
    setIsValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke('validate-setup');
      if (error) throw error;
      setValidation(data);
      
      if (data.overallStatus === 'ok') {
        toast.success('Todas as configurações estão corretas!');
      } else if (data.overallStatus === 'warning') {
        toast.warning('Sistema funcional, mas há itens opcionais pendentes');
      } else {
        toast.error('Há configurações obrigatórias pendentes');
      }
    } catch (error) {
      console.error('Validation error:', error);
      toast.error('Erro ao validar configurações');
    } finally {
      setIsValidating(false);
    }
  }, []);

  // Auto-validate on mount
  useEffect(() => {
    runValidation();
  }, [runValidation]);

  const completedSteps = steps.filter(s => s.isComplete);
  const requiredIncomplete = steps.filter(s => s.isRequired && !s.isComplete);

  const handleSendTest = async () => {
    if (!testPhone) {
      toast.error('Digite um número de telefone');
      return;
    }

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-whatsapp-message', {
        body: {
          phone_number: testPhone.replace(/\D/g, ''),
          message: testMessage,
        },
      });

      if (error) throw error;
      toast.success('Mensagem de teste enviada!');
    } catch (error: any) {
      console.error('Error sending test:', error);
      toast.error(error.message || 'Erro ao enviar mensagem de teste');
    } finally {
      setIsSending(false);
    }
  };

  const getStatusIcon = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const getStatusBg = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok': return 'bg-emerald-500/10 border-emerald-500/20';
      case 'warning': return 'bg-amber-500/10 border-amber-500/20';
      case 'error': return 'bg-red-500/10 border-red-500/20';
    }
  };

  const canComplete = requiredIncomplete.length === 0;

  return (
    <motion.div 
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="text-center mb-6">
        <motion.div 
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
        >
          <Rocket className="w-8 h-8 text-emerald-400" />
        </motion.div>
        <h3 className="text-xl font-semibold text-white mb-2">Validação do Sistema</h3>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Verificando todas as configurações antes de começar.
        </p>
      </motion.div>

      {/* Validation Results */}
      <motion.div variants={itemVariants} className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-slate-300">Verificação Automática</h4>
          <Button
            variant="secondary"
            size="sm"
            onClick={runValidation}
            disabled={isValidating}
            className="text-xs"
          >
            {isValidating ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Verificar
          </Button>
        </div>

        {validation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-2"
          >
            {/* Overall Status */}
            <div className={`p-4 rounded-xl border ${getStatusBg(validation.overallStatus)}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(validation.overallStatus)}
                  <div>
                    <p className="text-sm font-medium text-white">{validation.message}</p>
                    <p className="text-xs text-slate-400">
                      {validation.summary.ok}/{validation.summary.total} verificações OK
                    </p>
                  </div>
                </div>
                <div className={`text-2xl font-bold ${
                  validation.overallStatus === 'ok' ? 'text-emerald-400' :
                  validation.overallStatus === 'warning' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {validation.summary.percentage}%
                </div>
              </div>
            </div>

            {/* Individual Results */}
            <div className="grid grid-cols-2 gap-2">
              {validation.results.map((result, idx) => (
                <motion.div
                  key={result.component}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${getStatusBg(result.status)}`}
                >
                  {getStatusIcon(result.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {componentLabels[result.component] || result.component}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {isValidating && !validation && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="ml-2 text-sm text-slate-400">Validando...</span>
          </div>
        )}
      </motion.div>

      {/* Test Message Section */}
      <motion.div variants={itemVariants} className="max-w-md mx-auto pt-4 border-t border-slate-700/50">
        <h4 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
          <Send className="w-4 h-4" />
          Enviar Mensagem de Teste
        </h4>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="testPhone" className="text-slate-400 text-xs">
              Número de Telefone (com DDD)
            </Label>
            <Input
              id="testPhone"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="5511999999999"
              className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="testMessage" className="text-slate-400 text-xs">
              Mensagem de Teste
            </Label>
            <Input
              id="testMessage"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>

          <Button
            variant="secondary"
            onClick={handleSendTest}
            disabled={isSending || !testPhone}
            className="w-full"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Enviar Teste
              </>
            )}
          </Button>
        </div>
      </motion.div>

      {/* Complete Button */}
      <motion.div variants={itemVariants} className="max-w-md mx-auto pt-4">
        <Button
          variant="primary"
          onClick={onComplete}
          disabled={!canComplete}
          className="w-full py-3 text-base"
        >
          <Rocket className="w-5 h-5 mr-2" />
          Começar a Usar o Sistema
        </Button>
        {!canComplete && (
          <p className="text-xs text-slate-500 text-center mt-2">
            Corrija os erros de validação para continuar
          </p>
        )}
      </motion.div>
    </motion.div>
  );
};