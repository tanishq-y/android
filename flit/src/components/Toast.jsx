import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle size={16} style={{ color: '#059669' }} />,
  error:   <AlertCircle size={16} style={{ color: '#DC2626' }} />,
  info:    <Info        size={16} style={{ color: '#2563EB' }} />,
};

const BG = {
  success: '#F0FDF4',
  error:   '#FEF2F2',
  info:    '#EFF6FF',
};

const BORDER = {
  success: '#A7F3D0',
  error:   '#FECACA',
  info:    '#BFDBFE',
};

export default function ToastContainer({ toasts, onDismiss }) {
  return (
    <div
      className="fixed bottom-5 left-0 right-0 flex flex-col items-center gap-2 z-[9999] pointer-events-none px-4"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-[12px] border shadow-lg max-w-sm w-full"
            style={{
              background:   BG[toast.type]     ?? BG.info,
              borderColor:  BORDER[toast.type] ?? BORDER.info,
            }}
          >
            {ICONS[toast.type] ?? ICONS.info}
            <p className="flex-1 text-[13px] font-medium text-gray-800">
              {toast.message}
            </p>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
