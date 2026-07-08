import React from 'react';

type FormTitleVariant = 'field' | 'section';
type FormTitleSize = 'xs' | 'sm' | 'md';

interface FormTitleBaseProps {
  children: React.ReactNode;
  variant?: FormTitleVariant;
  size?: FormTitleSize;
  className?: string;
}

interface FormTitleLabelProps extends FormTitleBaseProps {
  as?: 'label';
  htmlFor?: string;
}

interface FormTitleSpanProps extends FormTitleBaseProps {
  as: 'span';
  htmlFor?: never;
}

type FormTitleProps = FormTitleLabelProps | FormTitleSpanProps;

const VARIANT_CLASSES: Record<
  FormTitleVariant,
  Record<FormTitleSize, string>
> = {
  field: {
    xs: 'text-xs font-medium text-(--foreground)/70',
    sm: 'text-sm font-medium text-(--foreground)/70',
    md: 'text-base font-medium text-(--foreground)/70',
  },
  section: {
    xs: 'font-medium uppercase tracking-wide text-xs tracking-wider text-slate-500 dark:text-slate-300',
    sm: 'font-medium uppercase tracking-wide text-sm text-slate-500 dark:text-slate-300',
    md: 'font-medium uppercase tracking-wide text-base text-slate-500 dark:text-slate-300',
  },
};

export function FormTitle({
  children,
  as = 'label',
  variant = 'field',
  size = 'xs',
  htmlFor,
  className,
}: FormTitleProps) {
  const textClasses = VARIANT_CLASSES[variant][size];
  const layoutClasses = className ?? 'mb-1 block';
  const Element = as;

  return (
    <Element className={`${layoutClasses} ${textClasses}`} htmlFor={htmlFor}>
      {children}
    </Element>
  );
}
