import React from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { toast } from 'sonner';

type ThemeOption = {
  value: 'light' | 'dark' | 'system';
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    label: 'Claro',
    description: 'Interface com fundo claro, ideal para ambientes bem iluminados.',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Escuro',
    description: 'Interface com fundo escuro, mais confortável em pouca luz.',
    icon: Moon,
  },
  {
    value: 'system',
    label: 'Sistema',
    description: 'Acompanha automaticamente o tema do seu sistema operacional.',
    icon: Monitor,
  },
];

const AppearanceSettings: React.FC = () => {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const handleSelect = (next: ThemeOption['value']) => {
    if (next === theme) return;
    setTheme(next);
    toast.success('Tema atualizado', {
      description:
        next === 'system'
          ? `Acompanhando o sistema (${resolvedTheme === 'dark' ? 'escuro' : 'claro'}).`
          : `Modo ${next === 'dark' ? 'escuro' : 'claro'} ativado.`,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Aparência</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Escolha como a interface deve ser exibida. A preferência é salva no seu navegador.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={`relative text-left rounded-lg border p-4 transition-all bg-card hover:border-primary/50 ${
                active
                  ? 'border-primary ring-2 ring-primary/40 shadow-sm'
                  : 'border-border'
              }`}
            >
              {active && (
                <span className="absolute top-3 right-3 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">
                  <Check className="w-3 h-3" />
                </span>
              )}
              <div
                className={`w-10 h-10 rounded-md flex items-center justify-center mb-3 ${
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="font-medium text-foreground">{opt.label}</div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        Tema ativo:{' '}
        <span className="text-foreground font-medium">
          {theme === 'system'
            ? `Sistema (${resolvedTheme === 'dark' ? 'escuro' : 'claro'})`
            : theme === 'dark'
            ? 'Escuro'
            : 'Claro'}
        </span>
      </div>
    </div>
  );
};

export default AppearanceSettings;
