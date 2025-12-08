export const MOCK_DOCUMENTS = [
  {
    id: 'doc_001',
    title: 'Clinical Trial Summary - CardioMax',
    coreClaims: 12,
    content: `Introduction

This document presents clinical findings for CardioMax, our new pharmaceutical treatment designed to address chronic cardiovascular conditions. The data presented herein represents findings from multiple Phase III clinical trials conducted across 45 research centers.

Clinical Efficacy

Our primary endpoint analysis demonstrates significant therapeutic benefit. Reduces cardiovascular events by 47% in clinical trials conducted over 24 weeks with 2,500 participants. This represents a meaningful improvement over existing standard-of-care treatments.

The treatment has achieved regulatory milestone status. FDA approved for adults 18 and older with established cardiovascular disease. This approval followed an expedited review process based on breakthrough therapy designation.

Dosage and Administration

The recommended dosage is 10mg once daily with food. Clinical studies showed optimal absorption when taken with a meal containing moderate fat content. Patients should take one tablet daily at the same time each day for best results.

Active Ingredients

Each tablet contains 10mg of CardioMax active compound (cardiomaxinil). Inactive ingredients include microcrystalline cellulose, magnesium stearate, and titanium dioxide for coating.

Comparative Analysis

In head-to-head studies against market leaders, the results were compelling. Outperforms Lipitor by 23% in LDL reduction measures. These findings were consistent across all demographic subgroups analyzed.

Patient satisfaction scores also showed marked improvement, with 84% of participants reporting positive outcomes compared to 61% in the control group.

Safety Profile

The treatment demonstrates a favorable safety profile overall. May cause mild side effects in approximately 8% of patients. The most common adverse events were headache (4.1%), muscle pain (2.3%), and digestive discomfort (1.6%), all of which resolved without intervention.

No serious adverse events were attributed to the treatment in any of the clinical trials. Long-term follow-up studies are ongoing to monitor extended safety outcomes.

Patient Testimonials

In our patient feedback program, Dr. Sarah Chen, a leading cardiologist, stated that 9 out of 10 of her patients showed improvement within 8 weeks. This aligns with our clinical observations.

Quality of Life Outcomes

Beyond clinical measures, patient-reported outcomes were encouraging. Clinically proven to improve cardiovascular health scores. The SF-36 health survey showed statistically significant improvements in both physical function and vitality composite scores.

Patients reported improved ability to perform daily activities, better exercise tolerance, and reduced chest discomfort during physical exertion.

Cost and Access

CardioMax is priced competitively at $45 per month, making it the most affordable branded cardiovascular treatment in its class. Patient assistance programs are available for qualifying individuals.

Conclusions

CardioMax represents a significant advancement in the management of cardiovascular conditions, offering both superior efficacy and an excellent safety profile.`
  },
  {
    id: 'doc_002',
    title: 'Marketing Brief - NeuroCalm',
    coreClaims: 10,
    content: `Product Overview

NeuroCalm is our breakthrough treatment for anxiety and stress-related disorders. Developed through 8 years of research, this innovative therapy offers a new approach to mental wellness.

Efficacy Claims

In controlled studies, NeuroCalm reduced anxiety symptoms by 62% compared to placebo. Participants reported significant improvement in sleep quality and daily functioning within just 2 weeks of treatment.

The medication provides 24-hour anxiety relief with once-daily dosing. This sustained release formula maintains consistent blood levels throughout the day.

Regulatory Status

NeuroCalm received FDA approval in March 2024 for generalized anxiety disorder in adults. The approval covers both initial treatment and maintenance therapy for long-term management.

Safety Information

Clinical trials demonstrated a favorable safety profile. Less than 3% of patients experienced drowsiness, and these effects typically resolved within the first week. No significant drug interactions were identified with common medications.

Dosage

Start with 5mg daily for the first week, then increase to 10mg daily. Maximum recommended dose is 20mg per day based on individual response and tolerability.

Ingredients

Active: Neurocalmine HCl 5mg, 10mg, or 20mg tablets. Contains no gluten, lactose, or artificial colors.

Market Comparison

NeuroCalm works faster than leading competitors, with onset of action within 30 minutes. Patient preference studies showed 78% chose NeuroCalm over their previous anxiety medication.

Expert Endorsement

Leading psychiatrists recommend NeuroCalm as a first-line treatment option. Dr. Michael Torres from Johns Hopkins notes it represents a significant advancement in anxiety treatment.

Pricing

Available for $89 per month. With insurance, most patients pay $25 or less. Manufacturer coupons available for uninsured patients.

Summary

NeuroCalm offers rapid, effective, and well-tolerated relief for anxiety sufferers, backed by robust clinical evidence.`
  }
]

// AI Analysis mode document - contains text that matches AI_ANALYSIS_CLAIMS exactly
export const AI_ANALYSIS_DOCUMENT = {
  id: 'ai_analysis_doc',
  title: 'Unverified Marketing Material - Sample',
  coreClaims: 0,
  content: `Product Marketing Draft

This document contains marketing claims that require AI analysis for regulatory compliance review. No brand guidelines are available for reference.

Efficacy Statements

Clinical studies suggest potential cardiovascular benefits in high-risk patient populations. These preliminary findings indicate promising results, though further validation may be required.

Our research team has observed that product may help with general wellness outcomes. This broad claim requires careful consideration before publication.

Regulatory Considerations

Recommended for adults with documented treatment-resistant conditions. Regulatory pathway discussions are ongoing with relevant authorities.

Dosage Information

Based on preliminary pharmacokinetic data, may be administered with or without food based on patient tolerance. Individual response may vary.

Comparative Claims

Shows favorable comparison to existing treatment protocols in preliminary analysis. Head-to-head studies are planned for the next phase.

Safety Data

Initial safety monitoring indicates that adverse events reported in less than 12% of study participants. Long-term safety data collection is ongoing.

Formulation Details

Contains proprietary blend of active pharmaceutical ingredients. Full ingredient disclosure pending final formulation approval.

Patient Feedback

Early access program results show that patient testimonials indicate high satisfaction with treatment regimen. Formal patient-reported outcomes studies are in development.

Conclusion

This material requires thorough review before external distribution.`
}

export const getDocumentById = (id) => MOCK_DOCUMENTS.find(doc => doc.id === id)

export const getRandomDocument = () => MOCK_DOCUMENTS[Math.floor(Math.random() * MOCK_DOCUMENTS.length)]

export const getAIAnalysisDocument = () => AI_ANALYSIS_DOCUMENT
