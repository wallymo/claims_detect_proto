export const MOCK_DOCUMENTS = [
  {
    id: 'doc_001',
    title: 'CardioMax Clinical Trial Summary',
    coreClaims: 12,
    content: `<h3>Introduction</h3>
<p>This document presents clinical findings for CardioMax, our new pharmaceutical treatment designed to address chronic cardiovascular conditions. The data presented herein represents findings from multiple Phase III clinical trials conducted across 45 research centers.</p>
<h3>Clinical Efficacy</h3>
<p>Our primary endpoint analysis demonstrates significant therapeutic benefit. Reduces cardiovascular events by 47% in clinical trials conducted over 24 weeks with 2,500 participants. This represents a meaningful improvement over existing standard-of-care treatments.</p>
<p>The treatment has achieved regulatory milestone status. FDA approved for adults 18 and older with established cardiovascular disease. This approval followed an expedited review process based on breakthrough therapy designation.</p>
<h3>Dosage and Administration</h3>
<p>The recommended dosage is 10mg once daily with food. Clinical studies showed optimal absorption when taken with a meal containing moderate fat content. Patients should take one tablet daily at the same time each day for best results.</p>
<h3>Active Ingredients</h3>
<p>Each tablet contains 10mg of CardioMax active compound (cardiomaxinil). Inactive ingredients include microcrystalline cellulose, magnesium stearate, and titanium dioxide for coating.</p>
<h3>Comparative Analysis</h3>
<p>In head-to-head studies against market leaders, the results were compelling. Outperforms Lipitor by 23% in LDL reduction measures. These findings were consistent across all demographic subgroups analyzed.</p>
<p>Patient satisfaction scores also showed marked improvement, with 84% of participants reporting positive outcomes compared to 61% in the control group.</p>
<h3>Safety Profile</h3>
<p>The treatment demonstrates a favorable safety profile overall. May cause mild side effects in approximately 8% of patients. The most common adverse events were headache (4.1%), muscle pain (2.3%), and digestive discomfort (1.6%), all of which resolved without intervention.</p>
<p>No serious adverse events were attributed to the treatment in any of the clinical trials. Long-term follow-up studies are ongoing to monitor extended safety outcomes.</p>
<h3>Patient Testimonials</h3>
<p>In our patient feedback program, Dr. Sarah Chen, a leading cardiologist, stated that 9 out of 10 of her patients showed improvement within 8 weeks. This aligns with our clinical observations.</p>
<h3>Quality of Life Outcomes</h3>
<p>Beyond clinical measures, patient-reported outcomes were encouraging. Clinically proven to improve cardiovascular health scores. The SF-36 health survey showed statistically significant improvements in both physical function and vitality composite scores.</p>
<p>Patients reported improved ability to perform daily activities, better exercise tolerance, and reduced chest discomfort during physical exertion.</p>
<h3>Cost and Access</h3>
<p>CardioMax is priced competitively at $45 per month, making it the most affordable branded cardiovascular treatment in its class. Patient assistance programs are available for qualifying individuals.</p>
<h3>Conclusions</h3>
<p>CardioMax represents a significant advancement in the management of cardiovascular conditions, offering both superior efficacy and an excellent safety profile.</p>`
  }
]

// AI Analysis mode document - contains text that matches AI_ANALYSIS_CLAIMS exactly
export const AI_ANALYSIS_DOCUMENT = {
  id: 'ai_analysis_doc',
  title: 'NEW_clinical data',
  coreClaims: 0,
  content: `<h3>Product Marketing Draft</h3>
<p>This document contains marketing claims that require AI analysis for regulatory compliance review. No brand guidelines are available for reference.</p>
<h3>Efficacy Statements</h3>
<p>Clinical studies suggest potential cardiovascular benefits in high-risk patient populations based on preliminary research. These findings indicate promising results, though further validation may be required.</p>
<p>Our research team has observed that product may help with general wellness outcomes in select populations. This broad claim requires careful consideration before publication.</p>
<h3>Regulatory Considerations</h3>
<p>Recommended for adults with documented treatment-resistant conditions per initial guidance. Regulatory pathway discussions are ongoing with relevant authorities.</p>
<h3>Dosage Information</h3>
<p>Based on preliminary pharmacokinetic data, may be administered with or without food based on patient tolerance as directed. Individual response may vary.</p>
<h3>Comparative Claims</h3>
<p>Shows favorable comparison to existing treatment protocols in preliminary analysis conducted last quarter. Head-to-head studies are planned for the next phase.</p>
<h3>Safety Data</h3>
<p>Initial safety monitoring indicates that adverse events reported in less than 12% of study participants during trials. Long-term safety data collection is ongoing.</p>
<h3>Formulation Details</h3>
<p>Contains proprietary blend of active pharmaceutical ingredients developed in-house. Full ingredient disclosure pending final formulation approval.</p>
<h3>Patient Feedback</h3>
<p>Early access program results show that patient testimonials indicate high satisfaction with treatment regimen overall. Formal patient-reported outcomes studies are in development.</p>
<h3>Conclusion</h3>
<p>This material requires thorough review before external distribution.</p>`
}

export const getDocumentById = (id) => MOCK_DOCUMENTS.find(doc => doc.id === id)

export const getDefaultDocument = () => MOCK_DOCUMENTS[0]

export const getAIAnalysisDocument = () => AI_ANALYSIS_DOCUMENT
